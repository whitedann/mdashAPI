let sql = require('mssql');
let fs = require('fs');
let readline = require('readline');
let reader = require("buffered-reader");
let DataReader = reader.DataReader;

const generateSchedule = async (worklist, connection) => {

	let scheduledSteps = [];
	let totalTime = 0;

	let context = worklist.RuntimeContext;
	if(!context){
		context = {
			UsesCytomat: 0,
			UsesDecapper: 0,
			UsesVSpin: 0,
			UsesEasyCode: 0,
			IncubationTime: 0,
			SpinTime: 0
		}
	}


	let methodCode = await lookupMethodCode(worklist.MethodID, worklist.SystemNumber, connection);
	let processSteps = await lookupProcessSteps(methodCode, context, connection);
	let arrayOfTaskLoops = [];

	if(processSteps.length === 0) { return 0; }

	for(const step of processSteps){

		let tableLoopPosition = step.TableLoopPosition;
		let tableLoopName = step.TableLoopName;
		let tableControlString = step.ControlString;
		
		let found = arrayOfTaskLoops.find( task => tableLoopPosition === task.TableLoopPosition && tableLoopName === task.TableLoopName );
		if(found){
			let newTask = {
				ProcessName: step.ProcessName,
				ProcessID: step.ProcessID,
				IsTracked: step.IsTracked,
				NTRUsage: step.NTRUsage,
				Usage1000UL: step.Usage1000UL,
				Usage300UL: step.Usage300UL
			}
			found.Processes.push(newTask);
		}
		else {
			let newTaskLoop = {                              	
                        	TableLoopPosition: tableLoopPosition,
                        	TableLoopName: tableLoopName,
				LoopControlString: tableControlString,
				Processes: []
                        }
			let newTask = {
				ProcessName: step.ProcessName,
				ProcessID: step.ProcessID,
                                IsTracked: step.IsTracked,
                                NTRUsage: step.NTRUsage,
                                Usage1000UL: step.Usage1000UL,
                                Usage300UL: step.Usage300UL
			}
			newTaskLoop.Processes.push(newTask)
                        arrayOfTaskLoops.push(newTaskLoop);
		}
	}

	for(const taskLoop of arrayOfTaskLoops){
		let taskAdded = false;
		for(const task of worklist.Tasks){
			if(taskLoop.TableLoopName === task.Task){
				for(const process of taskLoop.Processes){  
					scheduledSteps.push(process.ProcessName);
					let time1 = await getExpectedRuntimeOfStep(methodCode, process.ProcessName);
					totalTime += parseFloat(time1);
				}
				taskAdded = true;
			}
		}
		if(!taskAdded){
			scheduledSteps.push(taskLoop.Processes[0].ProcessName);
			let time2 = await getExpectedRuntimeOfStep(worklist.methodCode, taskLoop.Processes[0].ProcessName);
			totalTime += parseFloat(time2);
		}
	}
	return totalTime;

}

exports.generateSchedule = generateSchedule;

const generateRunQueryString = async (worklist, connection) => {
	let processSteps = await lookupProcessSteps(worklist.MethodCode, worklist.RuntimeContext, connection);

	if(processSteps.length === 0 || !processSteps) { 
		console.log("Could not find steps associated with this worklist!");
		return ""; 
	}

	let usesCytomat = "NULL";
	let usesDecapper = "NULL";
	let usesEasyCode = "NULL";
	let usesVSpin = "NULL";
	let incubationTime = 0;
	let vSpinTime = 0;
	if(!worklist.RuntimeContext) { 
		console.log("No context provided! Please update driver on system serving " + worklist.MethodCode); 
	}
	else{
		usesCytomat = (worklist.RuntimeContext.UsesCytomat === true ? 1 : (worklist.RuntimeContext.UsesCytomat === false ? 0 : "NULL"));
		usesDecapper = (worklist.RuntimeContext.UsesDecapper === true ? 1 : (worklist.RuntimeContext.UsesDecapper === false ? 0 : "NULL"));
		usesVSpin = (worklist.RuntimeContext.UsesVSpin === true ? 1 : (worklist.RuntimeContext.UsesVSpin === false ? 0 : "NULL"));
		usesEasyCode = (worklist.RuntimeContext.UsesEasyCode === true ? 1 : (worklist.RuntimeContext.UsesEasyCode === false ? 0 : "NULL"));
		incubationTime = worklist.RuntimeContext.IncubationTime;
		vSpinTime = worklist.RuntimeContext.SpinTime;
	}

	let arrayOfTaskLoops = [];

	processSteps.forEach( step => {

		let tableLoopPosition = step.TableLoopPosition;
		let tableLoopName = step.TableLoopName;
		
		let found = arrayOfTaskLoops.find( task => tableLoopPosition === task.TableLoopPosition && tableLoopName === task.TableLoopName );
		if(found){
			let newTask = {
				ProcessName: step.ProcessName,
				ProcessID: step.ProcessID,
				IsTracked: step.IsTracked,
				NTRUsage: step.NTRUsage,
				Usage1000UL: step.Usage1000UL,
				Usage300UL: step.Usage300UL,
				ExpectedRuntime: step.ExpectedRuntime
			}
			found.Processes.push(newTask);
		}
		else {
			let newTaskLoop = {                              	
                        	TableLoopPosition: tableLoopPosition,
                        	TableLoopName: tableLoopName,
				LoopControlString: step.ControlString,
				Processes: []
                        }
			let newTask = {
				ProcessName: step.ProcessName,
				ProcessID: step.ProcessID,
                                IsTracked: step.IsTracked,
                                NTRUsage: step.NTRUsage,
                                Usage1000UL: step.Usage1000UL,
                                Usage300UL: step.Usage300UL,
				ExpectedRuntime: step.ExpectedRuntime
			}
			newTaskLoop.Processes.push(newTask)
                        arrayOfTaskLoops.push(newTaskLoop);
		}
	});

	let _testQuery = "DECLARE @newID INT " +
				"BEGIN TRANSACTION " +
					"INSERT INTO RunInstance (Method, MethodCode, SystemName, SystemID, StatusOfRun, IsActive, SimulationOn, " +
									"UsingCytomat, UsingVSpin, UsingDecapper, UsingEasyCode, IncubationTime, VSpinTime, WorklistID) " +
					"VALUES (" +
						"\'" + worklist.MethodName + "\', " +
						"\'" + worklist.MethodCode + "\', " +
						"\'" + worklist.SystemName + "\', " +
						worklist.SystemNumber + ", " +
						"\'Running\', " +
						"1, " +
						worklist.SimulationOn + ", " +
						usesCytomat + ", " +
						usesVSpin + ", " + 
						usesDecapper + ", " + 
						usesEasyCode + ", " +
						incubationTime + ", " +
						vSpinTime + ", " +
						worklist.WorklistID + ") " +
					"SET @newID = SCOPE_IDENTITY(); ";

	let totalTime = 0;

	arrayOfTaskLoops.forEach(  (taskLoop) => {

		let taskAdded = false;
		let derivedTasks;
		let allTasks = [];
		
		if(taskLoop.LoopControlString !== "Once()"){
			derivedTasks = scanWorklistForTaskSatisfyingTaskLoopCondition(worklist,taskLoop);
			if(derivedTasks.Batches.length === 0) {
				for(let k = 0; k < taskLoop.Processes.length; k++){
					allTasks.push(taskLoop.Processes[k].ProcessName);
				}
			}
			else{
				for(let k = 0; k < derivedTasks.Batches.length; k++){
					allTasks.push(derivedTasks.Batches[k].Tasks[0].Task);
				}
			}
		}
		else{
			allTasks.push(taskLoop.TableLoopName);
		}

		allTasks.forEach( task => {
			if(taskLoop.TableLoopName === task){
				taskLoop.Processes.forEach( process => {
					totalTime += parseFloat(process.ExpectedRuntime);
					_testQuery += "INSERT INTO RunProcess_Linked (" + 
								"InstanceID, " +
								"ProcessName, " + 
								"ProcessID, " +
								"ProcessDetails, " + 
								"SourceBarcode, " + 
								"DestinationBarcode, " + 
								"IsTracked, " + 
								"RequiredNTRTips, " + 
								"Required1000ULTips, " + 
								"Required300ULTips) " +
							  "VALUES (" + 
								"@newID, " +
								"\'" + process.ProcessName + "\', " +
								"\'" + process.ProcessID + "\', " +
								"\'" + task.Details + "\', " +
								"\'" + task.SourcePlateBarcode + "\', " +
								"\'" + task.DestinationPlateBarcode + "\', " +
								"\'" + (process.IsTracked === true ? "1" : "0") + "\', " +
								"\'" + process.NTRUsage + "\', " +
								"\'" + process.Usage1000UL + "\', " +
								"\'" + process.Usage300UL + "\') " 
				});
			}
		});
	});

	_testQuery += "UPDATE RunInstance Set ExpectedRuntime = " + totalTime + " WHERE EntryID = @newID; ";
	_testQuery += "COMMIT TRANSACTION SELECT @newID;";

	return _testQuery;

}

exports.generateRunQueryString = generateRunQueryString;

const generateQueryString = async (worklist, connection) => {
	let processSteps = await lookupProcessSteps(worklist.MethodCode, worklist.RuntimeContext, connection);

	if(processSteps.length === 0 || !processSteps) { 
		console.log("Could not find steps associated with this worklist!");
		return ""; 
	}

	let usesCytomat = "NULL";
	let usesDecapper = "NULL";
	let usesEasyCode = "NULL";
	let usesVSpin = "NULL";
	let incubationTime = 0;
	let vSpinTime = 0;
	if(!worklist.RuntimeContext) { 
		console.log("No context provided! Please update driver on system serving " + worklist.MethodCode); 
	}
	else{
		usesCytomat = (worklist.RuntimeContext.UsesCytomat === true ? 1 : (worklist.RuntimeContext.UsesCytomat === false ? 0 : "NULL"));
		usesDecapper = (worklist.RuntimeContext.UsesDecapper === true ? 1 : (worklist.RuntimeContext.UsesDecapper === false ? 0 : "NULL"));
		usesVSpin = (worklist.RuntimeContext.UsesVSpin === true ? 1 : (worklist.RuntimeContext.UsesVSpin === false ? 0 : "NULL"));
		usesEasyCode = (worklist.RuntimeContext.UsesEasyCode === true ? 1 : (worklist.RuntimeContext.UsesEasyCode === false ? 0 : "NULL"));
		incubationTime = worklist.RuntimeContext.IncubationTime;
		vSpinTime = worklist.RuntimeContext.SpinTime;
	}

	let arrayOfTaskLoops = [];

	processSteps.forEach( step => {

		let tableLoopPosition = step.TableLoopPosition;
		let tableLoopName = step.TableLoopName;
		
		let found = arrayOfTaskLoops.find( task => tableLoopPosition === task.TableLoopPosition && tableLoopName === task.TableLoopName );
		if(found){
			let newTask = {
				ProcessName: step.ProcessName,
				ProcessID: step.ProcessID,
				IsTracked: step.IsTracked,
				NTRUsage: step.NTRUsage,
				Usage1000UL: step.Usage1000UL,
				Usage300UL: step.Usage300UL,
				ExpectedRuntime: step.ExpectedRuntime
			}
			found.Processes.push(newTask);
		}
		else {
			let newTaskLoop = {                              	
                        	TableLoopPosition: tableLoopPosition,
                        	TableLoopName: tableLoopName,
				LoopControlString: step.ControlString,
				Processes: []
                        }
			let newTask = {
				ProcessName: step.ProcessName,
				ProcessID: step.ProcessID,
                                IsTracked: step.IsTracked,
                                NTRUsage: step.NTRUsage,
                                Usage1000UL: step.Usage1000UL,
                                Usage300UL: step.Usage300UL,
				ExpectedRuntime: step.ExpectedRuntime
			}
			newTaskLoop.Processes.push(newTask)
                        arrayOfTaskLoops.push(newTaskLoop);
		}
	});

	let query = "DECLARE @newID INT " + 
			"BEGIN TRANSACTION " + 
				"INSERT INTO RunInstance (MethodName, MethodCode, SystemName, SystemID, StatusOfRun, IsActive, SimulationOn, " + 
								"UsingCytomat, UsingVSpin, UsingDecapper, UsingEasyCode, IncubationTime, VSpinTime, WorklistID) " + 
				"VALUES (" + 
					"\'" + worklist.MethodName + "\', " +
					"\'" + worklist.MethodCode + "\', " +
					"\'" + worklist.SystemName + "\', " +
					worklist.SystemNumber + ", " + 
					"\'Running\', " +
					"1, " +
					worklist.SimulationOn + ", " + 
					usesCytomat + ", " +
					usesVSpin + ", " +
					usesDecapper + ", " +
					usesEasyCode + ", " +
					incubationTime + ", " +
					vSpinTime + ", " +
					worklist.WorklistID + ") " + 
				"SET @newID = SCOPE_IDENTITY(); ";

	let _testQuery = "DECLARE @newID INT " +
				"BEGIN TRANSACTION " +
					"INSERT INTO RunInstance (Method, MethodCode, SystemName, SystemID, StatusOfRun, IsActive, SimulationOn, " +
									"UsingCytomat, UsingVSpin, UsingDecapper, UsingEasyCode, IncubationTime, VSpinTime, WorklistID) " +
					"VALUES (" +
						"\'" + worklist.MethodName + "\', " +
						"\'" + worklist.MethodCode + "\', " +
						"\'" + worklist.SystemName + "\', " +
						worklist.SystemNumber + ", " +
						"\'Running\', " +
						"1, " +
						worklist.SimulationOn + ", " +
						usesCytomat + ", " +
						usesVSpin + ", " + 
						usesDecapper + ", " + 
						usesEasyCode + ", " +
						incubationTime + ", " +
						vSpinTime + ", " +
						worklist.WorklistID + ") " +
					"SET @newID = SCOPE_IDENTITY(); ";

	let totalTime = 0;

	arrayOfTaskLoops.forEach(  (taskLoop) => {

		let taskAdded = false;
		let derivedTasks;
		let allTasks = [];
		
		if(taskLoop.LoopControlString !== "Once()"){
			derivedTasks = scanWorklistForTaskSatisfyingTaskLoopCondition(worklist,taskLoop);
			if(derivedTasks.Batches.length === 0) {
				for(let k = 0; k < taskLoop.Processes.length; k++){
					//console.log("No found entries in worklist for: " + taskLoop.Processes[k].ProcessName);
					allTasks.push(taskLoop.Processes[k].ProcessName);
				}
			}
			else{
				for(let k = 0; k < derivedTasks.Batches.length; k++){
					//console.log("The following tasks were derived from the worklist: " + derivedTasks.Batches[k].Tasks[0].Task);
					allTasks.push(derivedTasks.Batches[k].Tasks[0].Task);
					/**
					for(let m = 0; m < derivedTasks.Batches[k].Tasks.length; m++){
						console.log(derivedTasks.Batches[k].Tasks[m].Task);
						allTasks.push(derivedTasks.Batches[k].Tasks[m].Task);
					}
					**/
				}
			}
		}
		else{
			//console.log("The taskloop " + taskLoop.TableLoopName + " is not worklist driven");
			allTasks.push(taskLoop.TableLoopName);
		}

		allTasks.forEach( task => {
			if(taskLoop.TableLoopName === task){
				taskLoop.Processes.forEach( process => {
					totalTime += parseFloat(process.ExpectedRuntime);
					_testQuery += "INSERT INTO RunProcess (" + 
								"InstanceID, " +
								"ProcessName, " + 
								"ProcessID, " +
								"ProcessDetails, " + 
								"SourceBarcode, " + 
								"DestinationBarcode, " + 
								"IsTracked, " + 
								"RequiredNTRTips, " + 
								"Required1000ULTips, " + 
								"Required300ULTips) " +
							  "VALUES (" + 
								"@newID, " +
								"\'" + process.ProcessName + "\', " +
								"\'" + process.ProcessID + "\', " +
								"\'" + task.Details + "\', " +
								"\'" + task.SourcePlateBarcode + "\', " +
								"\'" + task.DestinationPlateBarcode + "\', " +
								"\'" + (process.IsTracked === true ? "1" : "0") + "\', " +
								"\'" + process.NTRUsage + "\', " +
								"\'" + process.Usage1000UL + "\', " +
								"\'" + process.Usage300UL + "\') " 
				});
			}
		});


		worklist.Tasks.forEach(  (task) => {
			if(taskLoop.TableLoopName === task.Task){
				taskLoop.Processes.forEach( (process) => { 
					totalTime += parseFloat(process.ExpectedRuntime);
					query += "INSERT INTO RunProcess (" + 
							"InstanceID, " +
							"ProcessName, " + 
							"ProcessDetails, " + 
							"SourceBarcode, " + 
							"DestinationBarcode, " + 
							"IsTracked, " + 
							"RequiredNTRTips, " + 
							"Required1000ULTips, " + 
							"Required300ULTips) " +
						  "VALUES (" + 
							"@newID, " +
							"\'" + process.ProcessName + "\', " +
							"\'" + task.Details + "\', " +
							"\'" + task.SourcePlateBarcode + "\', " +
							"\'" + task.DestinationPlateBarcode + "\', " +
							"\'" + (process.IsTracked === true ? "1" : "0") + "\', " +
							"\'" + process.NTRUsage + "\', " +
							"\'" + process.Usage1000UL + "\', " +
							"\'" + process.Usage300UL + "\') " 
				});
				taskAdded = true;
			}
		});
		if(!taskAdded){
			totalTime += parseFloat(taskLoop.Processes[0].ExpectedRuntime);
			query += "INSERT INTO RunProcess (" + 
					"InstanceID, " +
                        		"ProcessName, " + 
                        		"ProcessDetails, " + 
                        		"SourceBarcode, " + 
                        		"DestinationBarcode, " + 
                        		"IsTracked, " + 
                        		"RequiredNTRTips, " + 
                        		"Required1000ULTips, " + 
                        		"Required300ULTips) " +
                        	  "VALUES (" + 
					"@newID, " +
                        		"\'" + taskLoop.Processes[0].ProcessName + "\', " +
                        		"\'" + "No Details" + "\', " +
                        		"\'" + "No Source Plate" + "\', " +
                        		"\'" + "No Destination Plate" + "\', " +
                        		"\'" + (taskLoop.Processes[0].IsTracked === true ? "1" : "0") + "\', " +
                        		"\'" + taskLoop.Processes[0].NTRUsage + "\', " +
                        		"\'" + taskLoop.Processes[0].Usage1000UL + "\', " +
                        		"\'" + taskLoop.Processes[0].Usage300UL + "\'); " 
		}
	});

	query += "UPDATE RunInstance Set ExpectedRuntime = " + totalTime + " WHERE EntryID = @newID; ";
	_testQuery += "UPDATE RunInstance Set ExpectedRuntime = " + totalTime + " WHERE EntryID = @newID; ";

	query += "COMMIT TRANSACTION SELECT @newID;";
	_testQuery += "COMMIT TRANSACTION SELECT @newID;";

	return query;
}

exports.generateQueryString = generateQueryString;

async function lookupProcessSteps(methodCode, context, connection){
	let usesCytomat = "NULL";
	let usesDecapper = "NULL";
	let usesEasyCode = "NULL";
	let usesVSpin = "NULL";
	if(!context) { console.log("No context provided! Please update driver on system serving " + methodCode); }
	else{
		usesCytomat = (context.UsesCytomat === true ? 1 : (context.UsesCytomat === false ? 0 : 1));
		usesDecapper = (context.UsesDecapper === true ? 1 : (context.UsesDecapper === false ? 0 : 1));
		usesVSpin = (context.UsesVSpin === true ? 1 : (context.UsesVSpin === false ? 0 : 1));
		usesEasyCode = (context.UsesEasyCode === true ? 1 : (context.UsesEasyCode === false ? 0 : 1));
	}
	
	let query = "SELECT * FROM MethodProcesses WHERE MethodCode = \'" + methodCode + "\'" + 
			"AND UsesCytomat = " + usesCytomat + " " + 
			"AND UsesDecapper = " + usesDecapper + " " +
			"AND UsesVSpin = " + usesVSpin + " " +
			"AND UsesEasyCode = " + usesEasyCode + " " + 
			"AND RunType = \'Default\';";

	try{
		let request = new sql.Request(connection);
		const result = await request.query(query);
		return result.recordset;
	}
	catch{
		console.log("Failed to look up process steps for methodCode " + methodCode + ".");
	}
	console.log("No steps found. Check lookupProcessSteps");
	return [];
}

async function lookupMethodCode(methodID, systemNumber, connection){
	let query = "SELECT MethodCode FROM MethodProcesses WHERE NYSCFMethodID = " + methodID + " AND SystemNumber = " + systemNumber;
	let request = new sql.Request(connection);
	const result = await request.query(query);
	return result.recordset[0].MethodCode;
}

async function getNewSocketData(dbConnection) {

	let query = "Select RunInstance.*, RunProcess.* FROM RunInstance " +
			"INNER JOIN RunProcess ON RunProcess.InstanceID = RunInstance.EntryID " +
			"WHERE RunInstance.CreatedAt > DATEADD(HOUR, -24, GETDATE());";

	let request = new sql.Request(dbConnection);
	const result = await request.query(query);
	return result.recordset;
}

exports.getNewSocketData = getNewSocketData;

async function getExpectedRuntimeOfStep(methodCode, stepName){
	let expectedRunTime = 0;
	const fileStream = fs.createReadStream(appRoot + '/public/runtimeLibrary.txt');
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});

	for await (const line of rl) {
		const items = line.split(',');
		if(items[0] === methodCode && items[3] === stepName){
			expectedRunTime = items[2];
		}
	}
	return expectedRunTime;
}

function scanWorklistForTaskSatisfyingTaskLoopCondition(worklist, taskLoop){
	let groupOfBatches = {
		Batches: []
	};
	let constraintString = taskLoop.LoopControlString;
	//Gets the control for this loop 
	let controlString = constraintString.substr(0, constraintString.indexOf('(')); 
	let conditionString = constraintString.substr(constraintString.indexOf('(') + 1, (constraintString.length - (constraintString.indexOf('(') + 2)));
	let tokens = conditionString.split('.');	
	let currentBatchOfTasks = {
			Tasks: []
		};
	if(controlString === "ForEach"){
		let batchSize = parseInt(tokens[0]);
		let uniqueQualifier = tokens[1];
		let columnIdentifier = tokens[2];
		let batchIndex = 0;
		let plateCounter = 0;
		let uniqueness = (uniqueQualifier === "Unique" ? true : false);
		for(let i = 0; i < worklist.Tasks.length; i++){
			for(let property in worklist.Tasks[i]){
				if(Object.prototype.hasOwnProperty.call(worklist.Tasks[i], property)){
					if(property === columnIdentifier && worklist.Tasks[i].Task === taskLoop.TableLoopName){
						if(!uniqueness){
							currentBatchOfTasks.Tasks.push(worklist.Tasks[i]);
							plateCounter++;
							if(plateCounter === batchSize){
								groupOfBatches.Batches.push(currentBatchOfTasks);
								currentBatchOfTasks = {
									Tasks: []
								};
								plateCounter = 0;
								batchIndex++;
							}
							//Only added if plateCounter === batchSize ???? what if condition never satisfied?
						}
						else{
							let notUnique = false;
							//First check for duplicates in the current batch
							for(let l = 0; l < currentBatchOfTasks.Tasks.length; l++){
								if(currentBatchOfTasks.Tasks[l][columnIdentifier] === worklist.Tasks[i][columnIdentifier] 
									&& currentBatchOfTasks.Tasks[l].Task === worklist.Tasks[i].Task){
								
									notUnique = true;
								}
							}
							//Then check for duplicates in all other batches
							for(let l = 0; l < groupOfBatches.Batches.length; l++){
								for(let m = 0; m < groupOfBatches.Batches[l].Tasks.length; m++){
									if(groupOfBatches.Batches[l].Tasks[m][columnIdentifier] === worklist.Tasks[i][columnIdentifier] 
										&& groupOfBatches.Batches[l].Tasks[m].Task === worklist.Tasks[i].Task) {
										
										notUnique = true;
									}
								}
							}
							if(notUnique === false){
								currentBatchOfTasks.Tasks.push(worklist.Tasks[i]);
								plateCounter++;
								if(plateCounter == batchSize){
									groupOfBatches.Batches.push(currentBatchOfTasks);
									currentBatchOfTasks = {
										Tasks: []
									}
									plateCounter = 0;
									batchIndex++;
								}
								
							}
							
						}
						
					}
					//Adding any outstanding, unfilled batches
					if(i === (worklist.Tasks.length - 1) && plateCounter > 0){
							groupOfBatches.Batches.push(currentBatchOfTasks);
							currentBatchOfTasks = {
								Tasks: []
							};
							plateCounter = 0;
							batchIndex++;
					}
				}
				
			}
		}
	}
	else if(controlString === "If"){
		let columnIdentifier = tokens[0];
		let methodName = tokens[1];
		let methodParameter = tokens[2];
		if(methodName === "Exists"){
			//Check that this row exists
			for(let i = 0; i < worklist.Tasks.length; i++){
				if(taskLoop.TableLoopName === worklist.Tasks[i].Task){
					let newBatch = {
						Tasks: []
					};
					newBatch.Tasks.push(worklist.Tasks[i]);
					groupOfBatches.Batches.push(newBatch);
				}
			}
		}
		else if(methodName === "Contains"){
			for(let i = 0; i < worklist.Tasks.length; i++){
				if(worklist.Tasks[i].Task === taskLoop.TableLoopName){
					let cellValue = worklist.Tasks[i][columnIdentifier];
					if(cellValue.includes(methodParameter)){
						let newBatch = {
							Tasks: []
						};
						newBatch.Tasks.push(worklist.Tasks[i]);
						groupOfBatches.Batches.push(newBatch);
					}
				}
			}
		}
		else if(methodName === "Equals"){
			for(let i = 0; i < worklist.Tasks.length; i++){
				if(worklist.Tasks[i].Task === taskLoop.TableLoopName){
					let cellValue = worklist.Tasks[i][columnIdentifier];
					if(cellValue === methodParameter){
						let newBatch = {
							Tasks: []
						};
						newBatch.Tasks.push(worklist.Tasks[i]);
						groupOfBatches.Batches.push(newBatch);
					}
				}
			}
		}
	}
	return groupOfBatches;
}



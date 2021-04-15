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
			UsesCytomat: 1,
			UsesDecapper: 1,
			UsesVSpin: 1,
			UsesEasyCode: 1,
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
		usesCytomat = (worklist.RuntimeContext.UsesCytomat === 1 ? 1 : (worklist.RuntimeContext.UsesCytomat === 0 ? 0 : "NULL"));
		usesDecapper = (worklist.RuntimeContext.UsesDecapper === 1 ? 1 : (worklist.RuntimeContext.UsesDecapper === 0 ? 0 : "NULL"));
		usesVSpin = (worklist.RuntimeContext.UsesVSpin === 1 ? 1 : (worklist.RuntimeContext.UsesVSpin === 0 ? 0 : "NULL"));
		usesEasyCode = (worklist.RuntimeContext.UsesEasyCode === 1 ? 1 : (worklist.RuntimeContext.UsesEasyCode === 0 ? 0 : "NULL"));
		incubationTime = worklist.RuntimeContext.IncubationTime;
		vSpinTime = worklist.RuntimeContext.SpinTime;
	}

	console.log("Uses Cytomat: " + worklist.RuntimeContext.UsesCytomat);
	console.log("Uses Decapper: " + usesDecapper);
	console.log("Uses VSpin: " + usesVSpin);
	console.log("Uses EasyCode: " + usesEasyCode);
	console.log("Incubation Time: " + incubationTime);
	console.log("VSpin Time: " + vSpinTime);

	let arrayOfTaskLoops = [];

	//Build task loops from tempalte
	for(const step of processSteps){ 

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
				ExpectedRuntime: step.ExpectedRuntime,
				ControlString: step.ControlString
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
				ExpectedRuntime: step.ExpectedRuntime,
				ControlString: step.ControlString
			}
			newTaskLoop.Processes.push(newTask)
                        arrayOfTaskLoops.push(newTaskLoop);
		}
	}

	let queryToReturn = "DECLARE @newID INT " +
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

	let totalTime = 0;
	let lastProcessName = "";

	for(const taskLoop of arrayOfTaskLoops){

		if(lastProcessName === "End of Method")
			break;

		let derivedTasks;
		let allTasks = [];

		if(taskLoop.TableLoopName !== "None"){
			derivedTasks = await scanWorklistForTaskSatisfyingTaskLoopCondition(worklist,taskLoop);
			for(let k = 0; k < derivedTasks.Batches.length; k++){
				let listOfSourcePlates = "";
				let listOfDestinationPlates = "";
				let listOfDetails = "";
				let batchSize = 0;

				//Construct meta data tags for Source, Dest, Details (for the toolips etc)
				for(let l = 0; l < derivedTasks.Batches[k].Tasks.length; l++){
					batchSize++;
					if(l == derivedTasks.Batches[k].Tasks.length -1){
						listOfSourcePlates += derivedTasks.Batches[k].Tasks[l].SourcePlateBarcode;
						listOfDestinationPlates += derivedTasks.Batches[k].Tasks[l].DestinationPlateBarcode;
						listOfDetails += derivedTasks.Batches[k].Tasks[l].Details;
					}
					else{
						listOfSourcePlates += derivedTasks.Batches[k].Tasks[l].SourcePlateBarcode + ", ";
						listOfDestinationPlates += derivedTasks.Batches[k].Tasks[l].DestinationPlateBarcode + ", ";
						listOfDetails += derivedTasks.Batches[k].Tasks[l].Details + ", ";
					}
				}
				for(let m = 0; m < taskLoop.Processes.length; m++){
					let OKToAddTask = false;
					if(m !== 0){
						let satisfiedByWorklist = await checkThatWorklistSatisfiesCondition(worklist, taskLoop.Processes[m].ControlString); 
						if(satisfiedByWorklist){
							OKToAddTask = true;
						}
						else{
							OKToAddTask = false;
						}
					}
					//Always add first task in a loop
					else {
						OKToAddTask = true;
					}
					let plateIndexInBatch = getPlateIndexFromControlString(taskLoop.Processes[m].ControlString);
					if(plateIndexInBatch > derivedTasks.Batches[k].Tasks.length){
						OKToAddTask = false;
					}
					if(OKToAddTask){
						totalTime += parseFloat(taskLoop.Processes[m].ExpectedRuntime);
						lastProcessName = taskLoop.Processes[m].ProcessName;
						if(plateIndexInBatch !== -1){
							if(derivedTasks.Batches[k].Tasks[plateIndexInBatch-1]){
								listOfSourcePlates = derivedTasks.Batches[k].Tasks[plateIndexInBatch-1].SourcePlateBarcode;
								listOfDestinationPlates = derivedTasks.Batches[k].Tasks[plateIndexInBatch-1].DestinationPlateBarcode;
								listOfDetails = derivedTasks.Batches[k].Tasks[plateIndexInBatch-1].Details;
							}
						}
						queryToReturn += "INSERT INTO RunProcess (" + 
										"InstanceID, " +
										"ProcessName, " + 
										"ProcessDetails, " + 
										"SourceBarcode, " + 
										"DestinationBarcode, " +
										"BatchSize, " +
										"IsTracked, " + 
										"RequiredNTRTips, " + 
										"Required1000ULTips, " + 
										"Required300ULTips) " +
									  "VALUES (" + 
										"@newID, " +
										"\'" + taskLoop.Processes[m].ProcessName + "\', " +
										"\'" + listOfDetails + "\', " +
										"\'" + listOfSourcePlates + "\', " +
										"\'" + listOfDestinationPlates + "\', " +
										batchSize + ", " +
										"\'" + (taskLoop.Processes[m].IsTracked === true ? "1" : "0") + "\', " +
										"\'" + taskLoop.Processes[m].NTRUsage + "\', " +
										"\'" + taskLoop.Processes[m].Usage1000UL + "\', " +
										"\'" + taskLoop.Processes[m].Usage300UL + "\'); ";
					}
				}
			}
		}
		else{
			for(let m = 0; m < taskLoop.Processes.length; m++){
				let OKToAddTask = false;
				if(m !== 0){
					let satisfiedByWorklist = await checkThatWorklistSatisfiesCondition(worklist, taskLoop.Processes[m].ControlString); 
					if(satisfiedByWorklist){
						OKToAddTask = true;
					}
					else{
						OKToAddTask = false;
					}
				}
				//Always add first task in a loop
				else {
					OKToAddTask = true;
				}
				if(OKToAddTask){
					totalTime += parseFloat(taskLoop.Processes[m].ExpectedRuntime);
					queryToReturn += "INSERT INTO RunProcess (" + 
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
										"\'" + taskLoop.Processes[m].ProcessName + "\', " +
										"\'No Details\', " +
										"\'No Source Plate\', " +
										"\'No Destination Plate\', " +
										"\'" + (taskLoop.Processes[m].IsTracked === true ? "1" : "0") + "\', " +
										"\'" + taskLoop.Processes[m].NTRUsage + "\', " +
										"\'" + taskLoop.Processes[m].Usage1000UL + "\', " +
										"\'" + taskLoop.Processes[m].Usage300UL + "\'); ";

					lastProcessName = taskLoop.Processes[m].ProcessName;
				}
			}
		}
	}
	
	queryToReturn += "COMMIT TRANSACTION SELECT @newID;";

	return queryToReturn;

}


exports.generateRunQueryString = generateRunQueryString;

/**

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

	console.log("Uses Cytomat: " + usesCytomat);
	console.log("Uses Decapper: " + usesDecapper);
	console.log("Uses VSpin: " + usesVSpin);
	console.log("Uses EasyCode: " + usesEasyCode);
	console.log("Incubation Time: " + incubationTime);
	console.log("VSpin Time: " + vSpinTime);

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

	query += "COMMIT TRANSACTION SELECT @newID;";

	return query;
}

exports.generateQueryString = generateQueryString;

**/

async function lookupProcessSteps(methodCode, context, connection){
	let usesCytomat = "NULL";
	let usesDecapper = "NULL";
	let usesEasyCode = "NULL";
	let usesVSpin = "NULL";
	if(!context) { console.log("No context provided! Please update driver on system serving " + methodCode); }
	else{
		usesCytomat = (context.UsesCytomat === 1 ? 1 : (context.UsesCytomat === 0 ? 0 : 1));
		usesDecapper = (context.UsesDecapper === 1 ? 1 : (context.UsesDecapper === 0 ? 0 : 1));
		usesVSpin = (context.UsesVSpin === 1 ? 1 : (context.UsesVSpin === 0 ? 0 : 1));
		usesEasyCode = (context.UsesEasyCode === 1 ? 1 : (context.UsesEasyCode === 0 ? 0 : 1));
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

async function scanWorklistForTaskSatisfyingTaskLoopCondition(worklist, taskLoop){
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
		let staggeredQualifier = tokens[3];
		let batchIndex = 0;
		let plateCounter = 0;
		let uniqueness = (uniqueQualifier === "Unique" ? true : false);
		let staggered = (staggeredQualifier === "Staggered" ? true : false);
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
								//console.log("added plate to batch");
								plateCounter++;
								if(plateCounter == batchSize){
									//console.log("Batch full, creating new batch");
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
				}
			}
		}
		//Adding any outstanding, unfilled batches
		if(plateCounter > 0){
				console.log("Finished worklist with unfilled batch, adding the batch");
				groupOfBatches.Batches.push(currentBatchOfTasks);
				currentBatchOfTasks = {
					Tasks: []
				};
				plateCounter = 0;
				batchIndex++;
		}
		//Finally, if staggered, reorganize the groupings to be staggered
		if(staggered){
			//Deconstruct groupings
			let allTasks = [];
			for(let batchIndex = 0; batchIndex < groupOfBatches.Batches.length; batchIndex++){
				let currentBatch = groupOfBatches.Batches[batchIndex];
				for(let taskIndex = 0; taskIndex < batchSize; taskIndex++){
					allTasks.push(currentBatch.Tasks[taskIndex]);
				}
			}
			let staggeredGroupOfBatches = {
				Batches: []
			};
			for(let offsetIndex = 0; offsetIndex < allTasks.length; offsetIndex++){
				let newBatch = {
					Tasks: []
				}
				let firstTask = allTasks[offsetIndex];
				let secondTask = allTasks[offsetIndex+1];
				if(firstTask)
					newBatch.Tasks.push(firstTask);
				if(secondTask)
					newBatch.Tasks.push(secondTask);
				if(newBatch.Tasks.length > 0)
					staggeredGroupOfBatches.Batches.push(newBatch);
			}
			groupOfBatches = staggeredGroupOfBatches;
		}
	}
	else if(controlString === "If"){

		let columnIdentifier = tokens[0];
		let methodName = tokens[1];
		let methodParameter = tokens[2];

		if(methodName === "Exists"){
			//Check that this row exists
			for(let i = 0; i < worklist.Tasks.length; i++){
				if(columnIdentifier === worklist.Tasks[i].Task){
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
		else if(methodName === "DoesntContain"){
			for(let i = 0; i < worklist.Tasks.length; i++){
				if(worklist.Tasks[i].Task === taskLoop.TableLoopName){
					let cellValue = worklist.Tasks[i][columnIdentifier];
					if(!cellValue.includes(methodParameter)){
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
	else if(controlString === "Once"){
		for(let i = 0; i < worklist.Tasks.length; i++){
			if(worklist.Tasks[i].Task === taskLoop.TableLoopName){
				let newBatch = {
					Tasks: []
				};
				newBatch.Tasks.push(worklist.Tasks[i]);
				groupOfBatches.Batches.push(newBatch);
			}
		}
	}
	return groupOfBatches;
}

async function checkThatWorklistSatisfiesCondition(worklist, controlString){
	let controlStringToken = controlString.substr(0, controlString.indexOf('(')); 
	let conditionString = controlString.substr(controlString.indexOf('(') + 1, (controlString.length - (controlString.indexOf('(') + 2)));
	let conditionTokens = conditionString.split('.');
	
	if(controlString.includes("Once(")){
		return true;
	}
	if(controlStringToken === "If"){
		let rowToken = conditionTokens[0];
		let colToken = conditionTokens[1];
		let methodName = conditionTokens[2];
		let methodParam = conditionTokens[3];
		for(let i = 0; i < worklist.Tasks.length; i++){
			if(worklist.Tasks[i].Task === rowToken){
				let cellValue = worklist.Tasks[i][colToken];
				if(!cellValue) 
					continue;
				else{
					if(methodName === "Contains"){
						if(cellValue.includes(methodParam))
							return true;
						else
							return false;
					}
					else if(methodName == "DoesntContain"){
						if(!cellValue.includes(methodParam))
							return true;
						else
							return false;
						
					}
					else if(methodName === "Equals"){
						if(cellValue == methodParam)
							return true;
						else
							return false;
					}
				}
			}
		}
		return true;
	}
	else
		return false;
}

function getPlateIndexFromControlString(controlString){
	let control = controlString.substr(0,controlString.indexOf('('));
	if(control === "Once"){
		let innerToken = controlString.substr((controlString.indexOf('('), controlString.indexOf(')') - 1));
		return parseInt(innerToken);
	}
	else 
		return -1;
}

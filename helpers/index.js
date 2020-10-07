let sql = require('mssql');

const generateQueryString = async (methodCode, worklist) => {
	let processSteps = await lookupProcessSteps(methodCode);

	let arrayOfTaskLoops = [];

	processSteps.forEach( step => {
		
		let tableLoopPosition = step.TableLoopPosition;
		let tableLoopName = step.TableLoopName;
		
		let found = arrayOfTaskLoops.find( task => tableLoopPosition === task.TableLoopPosition && tableLoopName === task.TableLoopName );
		if(found){
			let newTask = {
				ProcessName: step.ProcessName,
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
				Processes: []
                        }
			let newTask = {
				ProcessName: step.ProcessName,
                                IsTracked: step.IsTracked,
                                NTRUsage: step.NTRUsage,
                                Usage1000UL: step.Usage1000UL,
                                Usage300UL: step.Usage300UL
			}
			newTaskLoop.Processes.push(newTask)
                        arrayOfTaskLoops.push(newTaskLoop);
		}
	});


	let query = "DECLARE @newID INT " + 
			"BEGIN TRANSACTION " + 
				"INSERT INTO RunInstance (MethodName, MethodCode, SystemName, SystemID, StatusOfRun, IsActive, SimulationOn) VALUES (" + 
				"\'" + worklist.MethodName + "\', " +
				"\'" + worklist.MethodCode + "\', " +
				"\'" + worklist.SystemName + "\', " +
				worklist.SystemNumber + ", " + 
				"\'Running\', " +
				"1, " +
				worklist.SimulationOn + ") " + 
				"SET @newID = SCOPE_IDENTITY(); ";

	arrayOfTaskLoops.forEach( taskLoop => {
		let taskAdded = false;
		worklist.Tasks.forEach( task => {
			if(taskLoop.TableLoopName === task.Task){
				taskLoop.Processes.forEach( process => { 
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
                        		"\'" + (process.IsTracked === true ? "1" : "0") + "\', " +
                        		"\'" + taskLoop.Processes[0].NTRUsage + "\', " +
                        		"\'" + taskLoop.Processes[0].Usage1000UL + "\', " +
                        		"\'" + taskLoop.Processes[0].Usage300UL + "\') " 
		}
	});

	query += "COMMIT TRANSACTION SELECT @newID;";

	return query; 
}


async function lookupProcessSteps(methodCode){
	let query = "SELECT * FROM MethodProcesses WHERE MethodCode = \'" + methodCode + "\'";
	let request = new sql.Request();
	const result = await request.query(query);
	return result;

}

exports.generateQueryString = generateQueryString;
	

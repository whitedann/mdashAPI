var express = require('express');
var bodyParser = require('body-parser');
var sql = require('mssql');
var http = require('http');
var fs = require('fs');
var Filereader = require('filereader');
var bodyParser = require('body-parser');
var nyscfUtils = require('./helpers');
var EmitTimer = require('./helpers/EmitTimer.js');
var path = require('path');
global.appRoot = path.resolve(__dirname);

var app = express();

app.use(function (req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, contentType, Content-Type, Accept, Authorization");
	next();
});


var port = process.env.port || 4000;
var requestCount = 0;
var numOfConnections = 0;

const timerMaxMilliseconds = 5000;

var server = app.listen(port, () => {
	console.log("Running on port ", port);
});

const socketIo = require("socket.io")(server);

let requestsCountMessage = setInterval( () => {
	console.log(new Date(Date.now()) + " Requests received: " + requestCount + " || Users connected: " + numOfConnections);
	requestCount = 0;
}, 5000);

var dbConfig = {
	user: "nyscf",
	password: "nyscfadmin",
	server: "nyscf-dashboard-restorednovember.comgzynzse2f.us-east-1.rds.amazonaws.com",
	database: "dashinfo"
};

var nyscfDBConfig = {
	user: "sa",
	password: "Suite450",
	server: "52.44.45.242",
	database: "NYSCF",
	requestTimeout: 30000
};

var lablimsDBConfig = {
	user: "sa",
	password: "Suite450",
	server: "52.44.45.242",
	database: "LabLIMS_Dev"
}

/**
var newDBConfig = {
	user: "dwhite",
	password: "Pwner450!",
	server: "52.44.45.242",
	database: "NYSCF"
}
**/

//const nyscfPool = new sql.ConnectionPool(nyscfDBConfig);
const dashboardPool = new sql.ConnectionPool(dbConfig);
const lablimsPool = new sql.ConnectionPool(lablimsDBConfig);
const newDB = new sql.ConnectionPool(nyscfDBConfig);

//nyscfPool.connect();
dashboardPool.connect();
lablimsPool.connect();
newDB.connect();

let emitTimer = new EmitTimer(async function(){
	let recordSet = await nyscfUtils.getNewSocketData(newDB);
	if(socketIo){
		emitTimer.resetTimer();
		console.log(new Date(Date.now()) + ": Update time timed out, emitting new data on all socket connections.");
		socketIo.sockets.emit('showrows', recordSet);
	}
}, 20000);

emitTimer.startTimer();

app.use(express.static('public'));

app.get('/api/info', (req, res) => {
	requestCount++;
	const file = `${__dirname}/public/runtimeLibrary.txt`;
	res.download(file);
});

var jsonParser = bodyParser.json();

app.post('/api/submitWorklist', jsonParser, async function(req, res, next) {
		requestCount++;
		let startTime = new Date().getTime();
		let query = await nyscfUtils.generateRunQueryString(req.body, newDB);
		let endTime = new Date().getTime();
		startTime = new Date().getTime();
		console.log("Time to generate transaction string: " + (endTime - startTime) / 1000 );
		if(query === ""){
			console.log("Could not find process steps related to submited worklist");
			res.status(200).json({"RunID" : -9999});
			return;
		}

		try {
			let request = new sql.Request(newDB);
			const submissionID = await request.query(query);
			//parsing of submissionID is due to the way the SQL query returns json object. 
			//(a single element array with empty string key)
			res.locals.RunID = submissionID.recordset[0][""];
			console.log("Generated RunID is: " + res.locals.RunID); 
			endTime = new Date().getTime();
			console.log( "Total time required for query: " + (endTime - startTime) / 1000 );
			res.status(200).json({"RunID" : res.locals.RunID});
		}
		catch(err){
			console.log(err + "\nError with submitWorklist route");
			let ostream = fs.createWriteStream(`${__dirname}/public/FailedRunAdditions.txt`);
			ostream.once('open', fd => {
				ostream.write("\n" + new Date(Date.now()) + ": Failed to add run " + req.body.MethodName + " on " + req.body.SystemName);
			});
	
		}
		next();
	}, async function(req, res) {
		try {
			let request = new sql.Request(newDB);
			let worklistInsertionQuery = "INSERT INTO DashWorklists (WorkListID, RunID, log) " +
							"VALUES (" + 
								"\'" + req.body.WorklistID + 
								"\', \'" + res.locals.RunID + 
								"\', \'" + JSON.stringify(req.body, null, 2) + 
								"\')";
			const submissionResponse = await request.query(worklistInsertionQuery);
			res.status(200).send();
		}
		catch(err){
			console.log(err + "\nError with submitWorklist route (2nd part where the worklist is saved)");
		}
});

app.post("/api/advanceRun", jsonParser,  async function(req, res) {
	console.log("Receiving request to advance run " + req.body.RunID);
	requestCount++;
	
	let queryStatus = 200;
	let query = "";

	if(!req.body.RunID || req.body.RunID === -1)
	{
		console.log("Invalid Run ID submitted");
		queryStatus = 404;
		res.status(queryStatus).send();
	}

	let consNTR = req.body.ConsumptionNTR !== undefined ? req.body.ConsumptionNTR : 0;
	let cons300 = req.body.Consumption300uL !== undefined ? req.body.Consumption300uL : 0;
	let cons1000 = req.body.Consumption1000uL !== undefined ? req.body.Consumption1000uL : 0;
	let runtime = req.body.Runtime !== undefined ? req.body.Runtime : 0;

	//If a specific ProcID is given (ideal), then the run will advance to nearest step with corresponding process
	//	so that the run can stay synced with dashboard.
	if(true){
	
		console.log("A process ID was not specified, so the next unfinished step is stamped");

		query = "BEGIN TRANSACTION " +
			"DECLARE @DataID int = " + req.body.RunID + "; " +

			//Set the finished step IsComplete field to 1 (completed)
			"WITH CTE AS (SELECT TOP 1 IsComplete AS COMP, " + 
						"ConsumptionNTR AS CONSUMPTIONNTR, " + 
						"Consumption1000UL AS CONSUMPTION1000UL, " + 
						"Consumption300UL AS CONSUMPTION300UL, " + 
						"Runtime AS STEPRUNTIME " +
			"FROM DashRunProcess WHERE DashRunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +

			"UPDATE CTE SET COMP = 1, CONSUMPTIONNTR = \'" + consNTR + "\', CONSUMPTION1000UL = \'" + cons1000 + "\', CONSUMPTION300UL = \'" + cons300 + "\', STEPRUNTIME = " + runtime + "; " +

			//Punch the start time of the next step.
			"WITH CTE (STARTTIME) AS (SELECT TOP 1 StartedAt FROM DashRunProcess WHERE DashRunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET STARTTIME = getdate(); " +
			"UPDATE DashRunInstance SET " +
				"DashRunInstance.CurrentProcessID = DashRunProcess.RunProcessID, " +
				"DashRunInstance.CurrentStep = DashRunProcess.ProcessName, " +
				"DashRunInstance.CurrentPlate = DashRunProcess.SourceBarcode, " +
				"DashRunInstance.LastUpdated = getdate(), " +
				"DashRunInstance.IsActive = 1 " +
				"FROM DashRunProcess " +
					"INNER JOIN DashRunInstance ON DashRunInstance.EntryID = DashRunProcess.InstanceID " +
				"WHERE DashRunProcess.InstanceID = @DataID " + 
					"AND DashRunProcess.StartedAt IS NOT NULL " +
					"AND DashRunProcess.isComplete = 0; " +
			"COMMIT";

	}
	else{
		query = "BEGIN TRANSACTION " +
			"DECLARE @DataID int = " + req.body.RunID + "; " +

			//Set the finished step IsComplete field to 1 (completed)
			";WITH CTE AS (SELECT TOP 1 IsComplete AS COMP FROM DashRunProcess WHERE DashRunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET COMP = 1; " +

			//Punch the start time of the next step.
			";WITH CTE (STARTTIME) AS (SELECT TOP 1 StartedAt FROM DashRunProcess WHERE DashRunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET STARTTIME = getdate(); " +
			"UPDATE DashRunInstance SET " +
				"DashRunInstance.CurrentProcessID = DashRunProcess.RunProcessID, " +
				"DashRunInstance.CurrentStep = DashRunProcess.ProcessName, " +
				"DashRunInstance.CurrentPlate = DashRunProcess.SourceBarcode, " +
				"DashRunInstance.LastUpdated = getdate(), " +
				"DashRunInstance.IsActive = 1 " +
				"FROM DashRunProcess " +
					"INNER JOIN DashRunInstance ON DashRunInstance.EntryID = DashRunProcess.InstanceID " +
				"WHERE DashRunProcess.InstanceID = @DataID " + 
					"AND DashRunProcess.StartedAt IS NOT NULL " +
					"AND DashRunProcess.IsComplete = 0; " +
			"COMMIT";

	}

	try{
		let request = new sql.Request(newDB);
		const result = await request.query(query);
		if(socketIo){
			emitTimer.resetTimer();
			let recordSet = await nyscfUtils.getNewSocketData(newDB);
			if(socketIo){
				emitTimer.resetTimer();
				console.log("Emitting Data");
				socketIo.sockets.emit('showrows', recordSet);
			}
		}
	}
	catch(err){
		console.log(err + "\n**Error advancing run**");
		queryStatus = 404;
	}
	res.status(queryStatus).send();
});

app.post("/api/updateRun", jsonParser, async function(req, res) {
	requestCount++;
	let query = "BEGIN TRANSACTION " +
		"UPDATE DashRunInstance SET " +
			"StatusOfRun =\'" + req.body.Status + "\'" +
		"WHERE EntryID = " + req.body.RunID + ";" +
		"COMMIT";
	try{
		let request = new sql.Request(newDB);
		const result = await request.query(query);
	}
	catch(err){
		console.log(err + "\n**Error updaing run**");
	}
	let recordSet = await nyscfUtils.getNewSocketData(newDB);
		if(socketIo){
			emitTimer.resetTimer();
			console.log("A run status  was updated, emitting on socket");
			socketIo.sockets.emit('showrows', recordSet);
		}
	res.status(200).send();
});

app.post("/api/updateNTRCount", jsonParser, async function(req, res, next) {
	requestCount++;
	if(req.body.RunID === -1) { 
		console.log("Could not update tip count because provided runID is invalid"); 
		return next(new Error());
	}
	if(req.body.CountNTR === undefined || req.body.Count1000uL === undefined || req.body.Count300uL === undefined){
		console.log("Could not update tip count because provided tip count was undefined");
		return next(new Error());
	}
	let query = "BEGIN TRANSACTION " +
			"UPDATE DashRunInstance SET " +
				"NTRCount = " + req.body.CountNTR + ", " +
				"NTRCapacity = " + req.body.CapacityNTR + ", " +
				"COUNT1000UL = " + req.body.Count1000uL + ", " +
				"CAPACITY1000UL = " + req.body.Capacity1000uL + ", " +
				"COUNT300UL = " + req.body.Count300uL + ", " +
				"CAPACITY300UL = " + req.body.Capacity300uL +
			" WHERE EntryID = " + req.body.RunID + "; " +
      		    "COMMIT;";
	try {
		console.log("Updating tips counts to:");
		console.log("NTR: " + req.body.CountNTR + "/" + req.body.CapacityNTR);
		console.log("1000uL: " + req.body.Count1000uL + "/" + req.body.Capacity1000uL);
		console.log("300uL: " + req.body.Count300uL + "/" + req.body.Capacity300uL);
		let request = new sql.Request(newDB);
		const result = await request.query(query);
		let recordSet = await nyscfUtils.getNewSocketData(newDB);
		if(socketIo){
			console.log("Tips change detected, emitting on socket");
			emitTimer.resetTimer();
			socketIo.sockets.emit('showrows', recordSet);
		}

	}
	catch(err){
		console.log(err + "\n**Error updating tip count**");
	}
		res.status(200).send();
});

app.post("/api/deactivateRun", jsonParser, async function(req, res) {
	console.log("Deactivating Run " + req.body.RunID);
	requestCount++;
	let query = "BEGIN TRANSACTION " +
			"DECLARE @DataID int = " + req.body.RunID + "; " +
			";WITH CTE AS (SELECT TOP 1 IsComplete AS COMP FROM DashRunProcess WHERE DashRunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET COMP = 1; " +
			"UPDATE DashRunInstance SET " +
				"LastUpdated = CURRENT_TIMESTAMP, " +
				"IsActive = 0 " +
			"WHERE EntryID = " + req.body.RunID + ";" +
		"COMMIT";
	try{
		let request = new sql.Request(newDB);
		const result = await request.query(query);
	}
	catch(err){
		console.log(err + "\n**Error deactivating run");
	}
	let recordSet = await nyscfUtils.getNewSocketData(newDB);
		if(socketIo){
			console.log("A run was deactivated, emitting on socket");
			emitTimer.resetTimer();
			socketIo.sockets.emit('showrows', recordSet);
		}
	res.status(200).send();
});


app.get("/api/generateruntimedata", (req, res, next) => {
	requestCount++;
	let query = "SELECT DashRunProcess.InstanceID, " +
		              "DashRunInstance.MethodName, " +
				"DashRunInstance.MethodCode, " +
				"DashRunProcess.BatchSize, " +
		              "DATEDIFF(second, DashRunProcess.StartedAt, LEAD(DashRunProcess.StartedAt) OVER (ORDER BY DashRunProcess.RunProcessID)) AS ElapsedTime, " +
		              "DashRunProcess.ProcessName " +
		       "FROM DashRunInstance " +
		       "INNER JOIN DashRunProcess ON DashRunInstance.EntryID = DashRunProcess.InstanceID " +
		       "WHERE DashRunInstance.isActive = 0 " +
		       "AND DashRunInstance.CreatedAt > DATEADD(DAY, -365, GETDATE()) " +
		       "AND DashRunInstance.StatusOfRun = \'Finished\' " +
		       "AND DashRunInstance.SimulationOn = 0;";

	let cyclesLibrary = []; 
	let statusCode = 503;
	res.locals.stepsQuery = "BEGIN TRANSACTION ";

	const retrieveData = new Promise( (resolve, reject) => {

		let request = new sql.Request(newDB);
		// streaming as recommended at npmjs.com/package/mssql#promises 
		request.stream = true;
		request.query(query);

		request.on('row', row => {
				let runEntryID = row.InstanceID;
				let methodName = row.MethodName;
				let methodCode = row.MethodCode;
				let stepName = row.ProcessName;
				let timeElapsed = row.ElapsedTime;
				if(stepName == "End Of Method" || stepName == "Start Of Method" || !timeElapsed || !methodCode) { return; }
				let methodInfo = cyclesLibrary.find( method => method.name === methodName && method.methodCode === methodCode);
				if(!methodInfo) { 
					let newMethod = { 
						name: methodName,
						methodCode: methodCode,
						stepsAndTimes: []
					}
					cyclesLibrary.push(newMethod);
					methodInfo = newMethod;
				}
				let stepInfo = methodInfo.stepsAndTimes.find(step => step.name === stepName);
				if(!stepInfo) {
					let newStep = {
						name: stepName,
						times: []
					}
					methodInfo.stepsAndTimes.push(newStep);
					stepInfo = newStep;
				}
				stepInfo.times.push(timeElapsed);
		});

		request.on('done', result => {
			console.log("Finished retrieving runtime data from database!");
			resolve();
		});

		request.on('error', result => {
			console.log("Could not retrieve runtime data from database!");
			resolve();
		})

	}).then( () => { 
		return new Promise((resolve, reject) => {
			let ostream = fs.createWriteStream(`${__dirname}/public/runtimeLibrary.txt`);
			ostream.once('open', fd => {
				ostream.write("*****NEW DATA GENERATED AT " + new Date(Date.now()) + "*****\n");
				cyclesLibrary.forEach( (method, index) => {                                                                        	
					method.stepsAndTimes.forEach( step => {
						const sum = step.times.reduce( (a,b) => a + b, 0);
						const avg = (sum / step.times.length) || 0;
						let median = 0;
						if(step.times.length === 0)
							median = 0;
						step.times.sort( function(a,b) {return a-b;} );
						let half = Math.floor(step.times.length / 2);
						if(step.times.length % 2)
							median = step.times[half];
						else
							median = (step.times[half - 1] + step.times[half]) / 2.0;
						ostream.write(method.methodCode + "," + method.name + "," + median + "," + step.name + "," + step.times.length + "," + avg + "\n");
						res.locals.stepsQuery += "UPDATE DashMethodProcesses SET ExpectedRuntime = " + parseInt(median) + 
										" WHERE ProcessName = \'" + step.name + "\'" + 
										" AND MethodCode = \'" + method.methodCode + "\'; ";
					});
					if(index === cyclesLibrary.length - 1){
						resolve();
					}
				});
			});
		});
	}).then( () => {
		return new Promise( async (resolve, reject) => {
			res.locals.stepsQuery += "COMMIT TRANSACTION GO";
			let updateRequest = new sql.Request(newDB);
			try {
				const result = await updateRequest.query(res.locals.stepsQuery);
				statusCode = 200;
			}
			catch(e){
				console.log(e);
			}
			resolve();
		});
	}).then( () => {
		return new Promise((resolve, reject) => {
			console.log("Finished generating runtime data, redirecting user");
			res.redirect(200, 'https://www.google.com');
			resolve();
		});
	}).catch( () => {
		console.log("Error in generateRuntime route");
		res.sendStatus(503);
	});
});

app.get("/api/getAllData.json", function(req, res){

	requestCount++;
	let query = "SELECT DashRunProcess.InstanceID, DashRunInstance.MethodName, DATEDIFF(second, DashRunProcess.StartedAt, LEAD(DashRunProcess.StartedAt) OVER (ORDER BY DashRunProcess.RunProcessID)) AS ElapsedTime, DashRunProcess.ProcessName, DashRunInstance.SimulationOn, DashRunInstance.SystemID, DashRunProcess.TipCountWhenThisStepStarted " +
		"FROM DashRunInstance INNER JOIN DashRunProcess ON DashRunInstance.EntryID = DashRunProcess.InstanceID " +
		"WHERE DashRunInstance.isActive = 0 AND DashRunInstance.CreatedAt > DATEADD(DAY, -365, GETDATE()) AND DashRunInstance.StatusOfRun = \'Finished\'  AND DashRunInstance.SimulationOn = 0";

	let obs = [];

	try {
		let request = new sql.Request(newDB);
		request.query(query, (err, rows) => {
			if(err) console.log(err);
			rows.recordset.forEach( row => {
				obs.push({
					InstanceID: row.InstanceID,
					MethodName: row.MethodName,
					ElapsedTime: row.ElapsedTime,
					ProcessName: row.ProcessName,
					SystemID: row.SystemID,
					TipSnapshot: row.TipCountWhenThisStepStarted,
					Simulation: row.SimulationOn
				});
			});
			res.send(JSON.stringify(obs));
		});
	}
	catch(err) {
		console.log(err + "\n**Error with getAllData.json route");
	}
	res.status(200).send();	
});

//updated
app.get("/api/getMethodTemplates.json", function(req, res){

	requestCount++;
	let query = "SELECT * FROM DashMethodProcesses;";
	let methods = [];
	try{
		let request = new sql.Request(newDB);
		request.query(query, (err, rows) => {
			if(err) console.log(err);
			rows.recordset.forEach( row => {
				let methodType = row.MethodType;
				let methodSystem = row.SystemNumber;
				let methodCode = row.MethodCode;
				let runtimeContext = {
					UsesCytomat: row.UsesCytomat,
					UsesDecapper: row.UsesDecapper,
					UsesEasyCode: row.UsesEasyCode,
					UsesVSpin: row.UsesVSpin
				};
				let methodInfo = methods.find( 
					method => (method.MethodType === methodType && method.MethodCode === methodCode)
				);
				if(!methodInfo){
					let newMethodTypeObject = {
						MethodType: methodType,
						MethodCode: methodCode,
						MethodSystem: methodSystem,
						Processes: [],
						};
					let newProcessObject = {
						ProcessName: row.ProcessName,
						WorklistTaskName: row.TableLoopName,
						TaskOrder: row.TableLoopPosition,
						ProcessOrder: row.TableProcessPosition,
						IsTracked: row.IsTracked,
						NTRUsage: row.NTRUsage,
						Usage1000uL: row.Usage1000UL,
						Usage300uL: row.Usage300UL,
						RuntimeContext: runtimeContext,
						ControlString: row.ControlString
					}
					newMethodTypeObject.Processes.push(newProcessObject);
					methods.push(newMethodTypeObject);
				}
				else{
					let newProcessObject = {
						ProcessName: row.ProcessName,
						WorklistTaskName: row.TableLoopName,
						TaskOrder: row.TableLoopPosition,
						ProcessOrder: row.TableProcessPosition,
						IsTracked: row.IsTracked,
						NTRUsage: row.NTRUsage,
						Usage1000uL: row.Usage1000UL,
						Usage300uL: row.Usage300UL,
						RuntimeContext: runtimeContext,
						ControlString: row.ControlString
					}
					methodInfo.Processes.push(newProcessObject);
				}
			});
			res.json(methods);
		});
	}
	catch(err){
		console.log(err + "\n**Error getting method templates");
	}
});


app.post("/api/editMethod", jsonParser, async function(req, res) {

	requestCount++;
	let query = "BEGIN TRANSACTION " +
		"DELETE FROM DashMethodProcesses WHERE MethodType = \'" + req.body.MethodType + "\' AND MethodCode = \'" + req.body.MethodCode + "\'" +
									" AND UsesCytomat = " + (req.body.RuntimeContext.UsesCytomat === true ? 1 : 0) + 
									" AND UsesDecapper = " + (req.body.RuntimeContext.UsesDecapper === true ? 1 : 0) + 
									" AND UsesEasyCode = " + (req.body.RuntimeContext.UsesEasyCode === true ? 1 : 0) +
									" AND UsesVSpin = " + (req.body.RuntimeContext.UsesVSpin === true ? 1 : 0) + "; ";

	let savingAsDefault = req.body.SavingAsDefault;
	let runType = "None";
	if(req.body.SavingAsDefault === true)
		runType = "Default";
	else
		runType = "Non-Default";

	if(savingAsDefault){
		query += "UPDATE DashMethodProcesses Set RunType = \'Non-default\' WHERE MethodCode = \'" + req.body.MethodCode + "\'; ";
	}


	let steps = req.body.data;
	steps.forEach( step => { 
		query += "INSERT INTO DashMethodProcesses " + 
					"(MethodType, " + 
					"ProcessName, " + 
					"TableLoopName, " + 
					"TableLoopPosition, " + 
					"TableProcessPosition, " +
					"MethodCode, " + 
					"RunType, " +
					"IsTracked, " +
					"NTRUsage, " +
					"Usage1000UL, " +
					"Usage300UL, " +
					"ControlString, " +
					"SystemNumber, " + 
					"UsesCytomat, " + 
					"UsesEasyCode, " + 
					"UsesVSpin, " +
					"UsesDecapper) " +
				"VALUES " + 
					"(\'" + req.body.MethodType + "\', " + 
					"\'" + step.ProcessName + "\', " + 
					"\'" + step.WorklistTaskName + "\', " + 
					step.TaskOrder + ", " + 
					step.ProcessOrder + ", " + 
					"\'" + req.body.MethodCode + "\', " + 
					"\'" + runType + "\', " +
					step.IsTracked  + ", " + 
					step.NTRUsage + ", " +
					step.Usage1000uL + ", " +
					step.Usage300uL + ", " +
					"\'" + step.ControlString + "\', " +
					req.body.SystemNumber + ", " + 
					(req.body.RuntimeContext.UsesCytomat === true ? 1 : 0) + ", " +
					(req.body.RuntimeContext.UsesEasyCode === true ? 1 : 0) + ", " +
					(req.body.RuntimeContext.UsesVSpin === true ? 1 : 0) + ", " + 
					(req.body.RuntimeContext.UsesDecapper === true ? 1 : 0) + ") ";
	});
	
	query += "COMMIT";

	try {
		let request = new sql.Request(newDB);
		const result = await request.query(query);
		res.status(200).send();
	}
	catch(err){
		console.log(err);
	}
});


app.get("/api/getRunEntries", async function(req, res) {
	requestCount++;
	let dateString = req.query.year + "-" + req.query.month + "-" + req.query.day + " 00:00:00.000";
	let query = "SELECT " + 
				"DashRunInstance.EntryID, DashRunInstance.MethodName, DashRunInstance.CreatedAt, DashRunInstance.LastUpdated, " +
				"DashRunInstance.SystemID, DashRunInstance.StatusOfRun, DashRunProcess.SourceBarcode, DashRunInstance.ExpectedRuntime, " + 
				"DashRunProcess.ProcessDetails, DashRunProcess.IsComplete, DashRunProcess.DestinationBarcode, DashRunInstance.SimulationOn " + 
				"FROM DashRunInstance " +
				"INNER JOIN DashRunProcess ON DashRunProcess.InstanceID = DashRunInstance.EntryID " +
				"WHERE DashRunInstance.CreatedAt > DATEADD(HOUR, -96, \'" + dateString + 
					"\') AND DashRunInstance.CreatedAt < DATEADD(HOUR, 96, \'" + dateString + "\')"; 
	//				" AND RunInstance.SimulationOn = 0;"

	try {
		const request = new sql.Request(newDB);
		const result = await request.query(query);
		console.log("getRunEntriesResult: " + result);
		res.status(200).send(result.recordset);
	}
	catch(err){
		console.log(err + "\n**Error with /api/getRunEntries");
	}
});

app.get("/api/getFutureReservations", async function(req, res, next) {
	requestCount++;
	let dateString = req.query.year + "-" + req.query.month + "-" + req.query.day + " 00:00:00.000";
	let query = "SELECT " +
			"RunActivities.ActivityName, " + 
			"RunActivities.SystemAssignedTo, " + 
			"RunActivities.StartTime_Scheduled, " + 
			"RunActivities.EndTime_Scheduled, " + 
			"RunActivities.MethodID, " + 
			"RunActivities.UserAssignedTo, " +
			"RunActivities.Status " +
			"FROM RunActivities " +
			"WHERE RunActivities.StartTime_Scheduled > DATEADD(HOUR, -96, \'" + 
				dateString + "\') AND RunActivities.StartTime_Scheduled <  DATEADD(HOUR, 96, \'" + dateString + "\');";
	try{
		const request = new sql.Request(lablimsPool);
		const result = await request.query(query);
		res.status(200).send(result.recordset);

	}
	catch(err){
		console.log(err + "\n**Error with getFutureReservations route");
	}
});

app.get("/api/getReservationBarcodes", async function(req, res, next) {

	requestCount++;
	let dateString = req.query.year + "-" + req.query.month + "-" + req.query.day + " 00:00:00.000";
	let query = "SELECT " + 
			"MethodReservations.Date, " +
			"MethodReservations.SystemID, " +
			"MethodReservations.MethodReservationID, " +
			"Lookup_ArrayMethods.MethodName, " +
			"MethodReservationsPlateBarcodes.PlateBarcode, " +
			"AppSuiteUsers.UserName, " +
			"Worklists.WorklistID " +
			"FROM MethodReservations " +
				"INNER JOIN MethodReservationsPlateBarcodes ON MethodReservationsPlateBarcodes.MethodReservationID = MethodReservations.MethodReservationID " +
				"INNER JOIN AppSuiteUsers ON AppSuiteUsers.UserID = MethodReservations.UserID " +
				"INNER JOIN Lookup_ArrayMethods ON Lookup_ArrayMethods.MethodID = MethodReservations.MethodID " +
				"INNER JOIN Worklists ON Worklists.MethodReservationID = MethodReservations.MethodReservationID " +
			"WHERE MethodReservations.Date > DATEADD(HOUR, -96, \'" + dateString + "\')";
	try{
		const request = new sql.Request(newDB);
		const result = await request.query(query);
		res.status(200).send(result.recordset);
	}
	catch(err){
		console.log(err + "\n**Error with getReservationBarcodes route");
	}

});

/**TEST ROUTES FOR CALENDAR SCHEDULING BEGIN**/
app.get("/api/getAllNYSCFMethods", async function(req, res, next) {
	requestCount++;
	let query = "SELECT MethodID, MethodName FROM Lookup_ArrayMethods;"
	try{
		const request = new sql.Request(newDB);
		const result = await request.query(query);
		res.status(200).send(result.recordset);
	}
	catch(err){
		console.log(err + "\n**Error with /getAllNYSCFMethods");
	}
});

app.get("/api/getAllDashboardMethods", async function(req, res, next) {
	requestCount++;
	let query = "SELECT DISTINCT MethodCode, SystemNumber, NYSCFMethodID " +
			"FROM DashMethodProcesses;"
	try {
		const request = new sql.Request(newDB);
		const result = await request.query(query);
		res.status(200).send(result.recordset);
	}
	catch(err){
		console.log(err + "\n**Error with /getMethodCodeInfo");
	}
});

app.get("/api/getExpectedRuntimeOfMethodCode", jsonParser, async function(req, res, next) {
	requestCount++;
	let query = "SELECT EntryID, DATEDIFF(second, DashRunInstance.CreatedAt, DashRunInstance.LastUpdated) AS ElapsedTime " +
			"FROM DashRunInstance WHERE " +
				"MethodCode = \'" + req.body.MethodCode + "\' AND " +
				"SimulationOn = 0 AND StatusOfRun = \'Finished\'";
	try{
		const request = new sql.Request(newDB);
		const result = await request.query(query);
		let sum = 0;
		let count = 0;
		result.recordset.forEach( row => {
			count++;
			sum += row.ElapsedTime;
		});
		//Calculating Mean
		let avg = sum / count ;
		res.json(avg);
	}
	catch(err){
		console.log(err + "\n**Error with /generateExpectedRuntimeOfMethodCode");
	}
});


app.post("/api/getExpectedRuntimeFromWorklist", jsonParser, async function(req, res, next){
	requestCount++;
	let predictedTime = await nyscfUtils.generateSchedule(req.body, newDB);
	console.log("Request for runtime of MethodID: " + req.body.MethodID + " on System " + req.body.SystemNumber + " is " + predictedTime + " seconds.");
	res.json(predictedTime);
});

app.get("/api/getWorklistFromWorklistID", async function(req, res, next){
	let worklistID = req.query.worklistID;
	console.log("request for worklist ID: " + worklistID);
	requestCount++;
	const query = "SELECT log FROM DashWorklists WHERE RunID = \'" + req.query.worklistID + "\';";
	try{
		const request = new sql.Request(newDB);
		const result = await request.query(query);
		res.status(200).send(result.recordset);
	}
	catch(err){
		console.log(err + "\nError with route /api/getWorklistFromWorklistID");
	}
});

/**TEST ROUTES FOR CALENDAR SCHEDULING END**/

socketIo.use(function(socket, next){
	numOfConnections++;
	next();
});

socketIo.on("connection", async function(socket){

	console.log("User has connected");
	let recordSet = await nyscfUtils.getNewSocketData(newDB);
	if(socketIo){
		emitTimer.resetTimer();
		console.log("Emitting Data");
		socketIo.sockets.emit('showrows', recordSet);
	}

	socket.on("disconnect", () => {
		console.log("client disconnected");
		numOfConnections--;
	});
});

//API will land here on error
app.use(function(req, res, next){
	console.log("URL requested and not found: " + req.originalUrl);
	let e = new Error("Not Found");
	e.status = 404;
	next(e);
});

app.use(function(e, req, res, next) {
	if(e.status = 404){
		res.send('THE PAGE WAS NOT FOUND');
	}
	else {
		res.json({
			error: e.message
		});
	}
});

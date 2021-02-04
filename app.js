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

const timerMaxMilliseconds = 10000;

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
	database: "NYSCF_Dev"
};

var lablimsDBConfig = {
	user: "sa",
	password: "Suite450",
	server: "52.44.45.242",
	database: "LabLIMS_Dev"
}

const nyscfPool = new sql.ConnectionPool(nyscfDBConfig);
const dashboardPool = new sql.ConnectionPool(dbConfig);
const lablimsPool = new sql.ConnectionPool(lablimsDBConfig);

nyscfPool.connect();
dashboardPool.connect();
lablimsPool.connect();

let emitTimer = new EmitTimer(async function(){
	let recordSet = await nyscfUtils.getNewSocketData(dashboardPool);
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
		let query = await nyscfUtils.generateQueryString(req.body, dashboardPool);

		if(query === ""){
			console.log("Could not find process steps related to the submitted worklist");
			return;
		}

		try {
			let request = new sql.Request(dashboardPool);
			const submissionID = await request.query(query);
			//parsing of submissionID is due to the way the SQL query returns json object. 
			//(a single element array with empty string key)
			res.locals.RunID = submissionID.recordset[0][""];
			console.log("Generated RunID is: " + res.locals.RunID); 
			res.status(200).json({"RunID" : res.locals.RunID});
		}
		catch(err){
			console.log(err + "\nError with submitWorklist route");
		}
		next();
	}, async function(req, res) {
		try {
			let request = new sql.Request(dashboardPool);
			let worklistInsertionQuery = "INSERT INTO Worklists (WorkListID, RunID, log) " +
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

app.post('/api/submitWorklist2', jsonParser, async function(req, res, next) {
		requestCount++;
		let query = await nyscfUtils.generateRunQueryString(req.body, dashboardPool);
		console.log("Query: " + query);
		if(query = ""){
			console.log("Could not find process steps related to submited worklist");
			return;
		}

		try {
			let request = new sql.Request(dashboardPool);
			const submissionID = await request.query(query);
			console.log(submissionID);
			//parsing of submissionID is due to the way the SQL query returns json object. 
			//(a single element array with empty string key)
			res.locals.RunID = submissionID.recordset[0][""];
			console.log("Generated RunID is: " + res.locals.RunID); 
			res.status(200).json({"RunID" : res.locals.RunID});
		}
		catch(err){
			console.log(err + "\nError with submitWorklist route");
		}
		next();
	}, async function(req, res) {
		try {
			let request = new sql.Request(dashboardPool);
			let worklistInsertionQuery = "INSERT INTO Worklists (WorkListID, RunID, log) " +
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

	//If a specific ProcID is given (ideal), then the run will advance to nearest step with corresponding process
	//	so that the run can stay synced with dashboard.
	if(true){
	
		console.log("A process ID was not specified, so the next unfinished step is stamped");

		let query = "BEGIN TRANSACTION " +
			"DECLARE @DataID int = " + req.body.RunID + "; " +

			//Set the finished step IsComplete field to 1 (completed)
			";WITH CTE AS (SELECT TOP 1 IsComplete AS COMP FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET COMP = 1; " +

			//Punch the start time of the next step.
			";WITH CTE (STARTTIME) AS (SELECT TOP 1 StartedAt FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET STARTTIME = getdate(); " +
			"UPDATE RunInstance SET " +
				"RunInstance.CurrentProcessID = RunProcess.RunProcessID, " +
				"RunInstance.CurrentStep = RunProcess.ProcessName, " +
				"RunInstance.CurrentPlate = RunProcess.SourceBarcode, " +
				"RunInstance.LastUpdated = getdate(), " +
				"RunInstance.IsActive = 1 " +
				"FROM RunProcess " +
					"INNER JOIN RunInstance ON RunInstance.EntryID = RunProcess.InstanceID " +
				"WHERE RunProcess.InstanceID = @DataID " + 
					"AND RunProcess.StartedAt IS NOT NULL " +
					"AND RunProcess.isComplete = 0; " +
			"COMMIT";

	}
	else{
		console.log("Process ID specified as " + req.query.ProcID);	

		let query = "BEGIN TRANSACTION " +
			"DECLARE @DataID int = " + req.body.RunID + "; " +

			//Set the finished step IsComplete field to 1 (completed)
			";WITH CTE AS (SELECT TOP 1 IsComplete AS COMP FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET COMP = 1; " +

			//Punch the start time of the next step.
			";WITH CTE (STARTTIME) AS (SELECT TOP 1 StartedAt FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET STARTTIME = getdate(); " +
			"UPDATE RunInstance SET " +
				"RunInstance.CurrentProcessID = RunProcess.RunProcessID, " +
				"RunInstance.CurrentStep = RunProcess.ProcessName, " +
				"RunInstance.CurrentPlate = RunProcess.SourceBarcode, " +
				"RunInstance.LastUpdated = getdate(), " +
				"RunInstance.IsActive = 1 " +
				"FROM RunProcess " +
					"INNER JOIN RunInstance ON RunInstance.EntryID = RunProcess.InstanceID " +
				"WHERE RunProcess.InstanceID = @DataID " + 
					"AND RunProcess.StartedAt IS NOT NULL " +
					"AND RunProcess.isComplete = 0; " +
			"COMMIT";

	}

	try{
		let request = new sql.Request(dashboardPool);
		const result = await request.query(query);
		if(socketIo){
			emitTimer.resetTimer();
			var query2 = "SELECT " +
					"RunInstance.MethodName, RunInstance.EntryID, RunInstance.CurrentStep, " +
					"RunInstance.StatusOfRun, RunInstance.SystemID, RunProcess.StartedAt, " + 
					"RunInstance.IsActive, RunInstance.SimulationOn, RunInstance.NTRCount, " + 
					"RunInstance.COUNT1000UL, RunInstance.COUNT300UL, RunInstance.CAPACITY1000UL, " + 
					"RunInstance.CAPACITY300UL, RunProcess.ProcessName, RunProcess.SourceBarcode, " + 
					"RunProcess.IsComplete, RunInstance.NTRCapacity, RunProcess.RunProcessID, " + 
					"RunInstance.CurrentProcessID, RunProcess.IsTracked, RunInstance.MethodCode, " + 
					"RunProcess.RequiredNTRTips, RunProcess.Required1000ULTips, RunProcess.Required300ULTips " +
					"FROM RunInstance " +
				"INNER JOIN RunProcess ON RunProcess.InstanceID = RunInstance.EntryID " +
				"WHERE RunInstance.CreatedAt > DATEADD(HOUR, -24, GETDATE());";


			let request = new sql.Request(dashboardPool);
			const result = request.query(query2, function(err, rows){
				if(err) {
					console.log(err);
					throw err;
				}
				socketIo.sockets.emit('showrows', rows.recordset);
			});
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
		"UPDATE RunInstance SET " +
			"StatusOfRun =\'" + req.body.Status + "\'" +
		"WHERE EntryID = " + req.body.RunID + ";" +
		"COMMIT";
	try{
		let request = new sql.Request(dashboardPool);
		const result = await request.query(query);
	}
	catch(err){
		console.log(err + "\n**Error updaing run**");
	}
	let recordSet = await nyscfUtils.getNewSocketData(dashboardPool);
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
			"UPDATE RunInstance SET " +
				"NTRCount = " + req.body.CountNTR + ", " +
				"NTRCapacity = " + req.body.CapacityNTR + ", " +
				"COUNT1000UL = " + req.body.Count1000uL + ", " +
				"CAPACITY1000UL = " + req.body.Capacity1000uL + ", " +
				"COUNT300UL = " + req.body.Count300uL + ", " +
				"CAPACITY300UL = " + req.body.Capacity300uL +
			" WHERE EntryID = " + req.body.RunID + "; " +
      		    "COMMIT;";
	try {
		let request = new sql.Request(dashboardPool);
		const result = await request.query(query);
	}
	catch(err){
		console.log(err + "\n**Error updating tip count**");
	}
	let recordSet = await nyscfUtils.getNewSocketData(dashboardPool);
		if(socketIo){
			console.log("Tips change detected, emitting on socket");
			emitTimer.resetTimer();
			socketIo.sockets.emit('showrows', recordSet);
		}
	res.status(200).send();
});

app.post("/api/deactivateRun", jsonParser, async function(req, res) {
	console.log("Deactivating Run " + req.body.RunID);
	requestCount++;
	let query = "BEGIN TRANSACTION " +
			"DECLARE @DataID int = " + req.body.RunID + "; " +
			";WITH CTE AS (SELECT TOP 1 IsComplete AS COMP FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET COMP = 1; " +
			"UPDATE RunInstance SET " +
				"LastUpdated = CURRENT_TIMESTAMP, " +
				"IsActive = 0 " +
			"WHERE EntryID = " + req.body.RunID + ";" +
		"COMMIT";
	try{
		let request = new sql.Request(dashboardPool);
		const result = await request.query(query);
	}
	catch(err){
		console.log(err + "\n**Error deactivating run");
	}
	let recordSet = await nyscfUtils.getNewSocketData(dashboardPool);
		if(socketIo){
			console.log("A run was deactivated, emitting on socket");
			emitTimer.resetTimer();
			socketIo.sockets.emit('showrows', recordSet);
		}
	res.status(200).send();
});


app.get("/api/generateruntimedata", (req, res, next) => {
	requestCount++;
	let query = "SELECT RunProcess.InstanceID, " +
		              "RunInstance.MethodName, " +
				"RunInstance.MethodCode, " +
		              "DATEDIFF(second, RunProcess.StartedAt, LEAD(RunProcess.StartedAt) OVER (ORDER BY RunProcess.RunProcessID)) AS ElapsedTime, " +
		              "RunProcess.ProcessName " +
		       "FROM RunInstance " +
		       "INNER JOIN RunProcess ON RunInstance.EntryID = RunProcess.InstanceID " +
		       "WHERE RunInstance.isActive = 0 " +
		       "AND RunInstance.CreatedAt > DATEADD(DAY, -190, GETDATE()) " +
		       "AND RunInstance.StatusOfRun = \'Finished\' " +
		       "AND RunInstance.SimulationOn = 0;";

	let cyclesLibrary = []; 
	let statusCode = 503;
	res.locals.stepsQuery = "BEGIN TRANSACTION ";

	const retrieveData = new Promise( (resolve, reject) => {

		let request = new sql.Request(dashboardPool);
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
						res.locals.stepsQuery += "UPDATE MethodProcesses SET ExpectedRuntime = " + parseInt(median) + 
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
		return new Promise((resolve, reject) => {
			res.locals.stepsQuery += "COMMIT TRANSACTION GO";
			let updateRequest = new sql.Request(dashboardPool);
			try {
				const result = updateRequest.query(res.locals.stepsQuery);
				statusCode = 200;
			}
			catch(e){
				console.log(e);
			}
			resolve();
		});
	}).then( () => {
		return new Promise((resolve, reject) => {
			res.redirect(statusCode, '/');
			resolve();
		});
	}).catch( () => {
		console.log("Error in generateRuntime route");
		res.sendStatus(503);
	});
});

app.get("/api/getAllData.json", function(req, res){

	requestCount++;
	let query = "SELECT RunProcess.InstanceID, RunInstance.MethodName, DATEDIFF(second, RunProcess.StartedAt, LEAD(RunProcess.StartedAt) OVER (ORDER BY RunProcess.RunProcessID)) AS ElapsedTime, RunProcess.ProcessName, RunInstance.SimulationOn, RunInstance.SystemID, RunProcess.TipCountWhenThisStepStarted " +
		"FROM RunInstance INNER JOIN RunProcess ON RunInstance.EntryID = RunProcess.InstanceID " +
		"WHERE RunInstance.isActive = 0 AND RunInstance.CreatedAt > DATEADD(DAY, -365, GETDATE()) AND RunInstance.StatusOfRun = \'Finished\'  AND RunInstance.SimulationOn = 0";

	let obs = [];

	try {
		let request = new sql.Request(dashboardPool);
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


app.get("/api/getMethodTemplates.json", function(req, res){

	requestCount++;
	let query = "SELECT * FROM MethodProcesses";
	let methods = [];
	try{
		let request = new sql.Request(dashboardPool);
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
		"DELETE FROM MethodProcesses WHERE MethodType = \'" + req.body.MethodType + "\' AND MethodCode = \'" + req.body.MethodCode + "\'" +
									" AND UsesCytomat = " + (req.body.RuntimeContext.UsesCytomat === true ? 1 : 0) + 
									" AND UsesDecapper = " + (req.body.RuntimeContext.UsesDecapper === true ? 1 : 0) + 
									" AND UsesEasyCode = " + (req.body.RuntimeContext.UsesEasyCode === true ? 1 : 0) +
									" AND UsesVSpin = " + (req.body.RuntimeContext.UsesVSpin === true ? 1 : 0) + "; ";
	let steps = req.body.data;
	steps.forEach( step => { 
		query += "INSERT INTO MethodProcesses " + 
					"(MethodType, " + 
					"ProcessName, " + 
					"TableLoopName, " + 
					"TableLoopPosition, " + 
					"TableProcessPosition, " +
					"MethodCode, " + 
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
		let request = new sql.Request(dashboardPool);
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
				"RunInstance.EntryID, RunInstance.MethodName, RunInstance.CreatedAt, RunInstance.LastUpdated, " +
				"RunInstance.SystemID, RunInstance.StatusOfRun, RunProcess.SourceBarcode, RunInstance.ExpectedRuntime, " + 
				"RunProcess.ProcessDetails, RunProcess.IsComplete, RunProcess.DestinationBarcode, RunInstance.SimulationOn " + 
				"FROM RunInstance " +
				"INNER JOIN RunProcess ON RunProcess.InstanceID = RunInstance.EntryID " +
				"WHERE RunInstance.CreatedAt > DATEADD(HOUR, -96, \'" + dateString + 
					"\') AND RunInstance.CreatedAt < DATEADD(HOUR, 96, \'" + dateString + "\')"; 
	//				" AND RunInstance.SimulationOn = 0;"

	try {
		const request = new sql.Request(dashboardPool);
		const result = await request.query(query);
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

/**TEST ROUTES FOR CALENDAR SCHEDULING BEGIN**/
app.get("/api/getAllNYSCFMethods", async function(req, res, next) {
	requestCount++;
	let query = "SELECT MethodID, MethodName FROM Lookup_ArrayMethods;"
	try{
		const request = new sql.Request(nyscfPool);
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
			"FROM MethodProcesses "
	try {
		const request = new sql.Request(dashboardPool);
		const result = await request.query(query);
		res.status(200).send(result.recordset);
	}
	catch(err){
		console.log(err + "\n**Error with /getMethodCodeInfo");
	}
});

app.get("/api/generateExpectedRuntimeOfMethodCode", async function(req, res, next) {
	requestCount++;
	let query = "SELECT EntryID, DATEDIFF(second, RunInstance.CreatedAt, RunInstance.LastUpdated) AS ElapsedTime " +
			"FROM RunInstance WHERE " +
				"MethodCode = \'" + req.query.methodID + "\' AND " +
				"SimulationOn = 0 AND StatusOfRun = \'Finished\'";
	try{
		const request = new sql.Request(dashboardPool);
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
	let predictedTime = await nyscfUtils.generateSchedule(req.body, dashboardPool);
	console.log("Request for runtime of MethodID: " + req.body.MethodID + " on System " + req.body.SystemNumber + " is " + predictedTime + " seconds.");
	res.json(predictedTime);
});

app.get("/api/getWorklistFromWorklistID", async function(req, res, next){
	let worklistID = req.query.worklistID;
	console.log("request for worklist ID: " + worklistID);
	requestCount++;
	const query = "SELECT log FROM Worklists WHERE RunID = \'" + req.query.worklistID + "\';";
	try{
		const request = new sql.Request(dashboardPool);
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
	let recordSet = await nyscfUtils.getNewSocketData(dashboardPool);
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

var express = require('express');
var bodyParser = require('body-parser');
var sql = require('mssql');
var http = require('http');
var socketIo = require("socket.io");
var fs = require('fs');
var Filereader = require('filereader');
var bodyParser = require('body-parser');
var nyscfUtils = require('./helpers');

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

var server = app.listen(port, () => {
	console.log("Running on port ", port);
});

let requestsCountMessage = setInterval( () => {
	console.log("Requests received this interval: " + requestCount);
	console.log("Number of connected users: " + numOfConnections);
	requestCount = 0;
}, 5000);

var dbConfig = {
	user: "nyscf",
	password: "nyscfadmin",
	server: "nyscf-dashboard.comgzynzse2f.us-east-1.rds.amazonaws.com",
	database: "dashinfo"
};

var nyscfDBConfig = {
	user: "sa",
	password: "Suite450",
	server: "52.44.45.242",
	database: "NYSCF_Dev"
};

const nyscfPool = new sql.ConnectionPool(nyscfDBConfig);
const dashboardPool = new sql.ConnectionPool(dbConfig);
nyscfPool.connect();
dashboardPool.connect();

var io = socketIo(server);

app.use(express.static('public'));

app.get('/api/info', (req, res) => {
	requestCount++;
	const file = `${__dirname}/public/runtimeLibrary.txt`;
	res.download(file);
});

var jsonParser = bodyParser.json();

app.post('/api/submitWorklist', jsonParser, async function(req, res) {
	requestCount++;
	let query = await nyscfUtils.generateQueryString(req.body.MethodCode, req.body, dashboardPool);
	try {
		let request = new sql.Request(dashboardPool);
		const submissionID = await request.query(query);
		//parsing of submissionID is due to the way the SQL query returns json object. 
		//(a single element array with empty string key)
		console.log("Generated RunID is: " + submissionID.recordset[0][""]);
        	res.status(200).json({"RunID" : submissionID.recordset[0][""]});
	}
	catch(err){
		console.log(err + "\nError with submitWorklist route");
	}
});

app.post("/api/advanceRun", jsonParser,  async function(req, res) {
	console.log("Receiving request to advance run " + req.body.RunID)
	requestCount++;
	if(!req.body.RunID || req.body.RunID === -1)
	{
		console.log("Invalid Run ID submitted");
		res.status(404).send();
	}
	let query = "BEGIN TRANSACTION " +
			"DECLARE @DataID int = " + req.body.RunID + "; " +

			//Set the finished step IsComplete field to 1 (completed)
			";WITH CTE AS (SELECT TOP 1 IsComplete AS COMP FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			"UPDATE CTE SET COMP = 1; " +

			//Set the finished step IsActive field to 0 (not the active step anymore)
			//";WITH CTE AS (SELECT TOP 1 IsActiveStep AS ISACTIVE FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			//"UPDATE CTE SET ISACTIVE = 0; " +
			
			//Set the next step IsActive field to 1 (is now the active step)
			//";WITH CTE AS (SELECT TOP 1 IsActiveStep AS ISACTIVE FROM RunProcess WHERE RunProcess.IsComplete = 0 AND InstanceID = @DataID ORDER BY RunProcessID ASC) " +
			//"UPDATE CTE SET ISACTIVE = 1; " +
			
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
	let request = new sql.Request(dashboardPool);
	try{
		const result = await request.query(query);
		console.dir("Result: " + result.info);	
	}
	catch(err){
		console.log(err + "\n**Error advancing run**");
	}
	res.status(200).send();
});

app.post("/api/updateRun", jsonParser, async function(req, res) {
	//console.log("Receiving request to update run " + req.body.RunID + " to status " + req.body.Status);
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
	res.status(200).send();
});


app.get("/api/generateruntimedata", (req, res) => {
	requestCount++;
	let query = "SELECT RunProcess.InstanceID, " +
		              "RunInstance.MethodName, " +
		              "DATEDIFF(second, RunProcess.StartedAt, LEAD(RunProcess.StartedAt) OVER (ORDER BY RunProcess.RunProcessID)) AS ElapsedTime, " +
		              "RunProcess.ProcessName " +
		       "FROM RunInstance " +
		       "INNER JOIN RunProcess ON RunInstance.EntryID = RunProcess.InstanceID " +
		       "WHERE RunInstance.isActive = 0 " +
		       "AND RunInstance.CreatedAt > DATEADD(DAY, -190, GETDATE()) " +
		       "AND RunInstance.StatusOfRun = \'Finished\' " +
		       "AND RunInstance.SimulationOn = 0;";

	let cyclesLibrary = []; 

	let request = new sql.Request(dashboardPool);
	request.query(query, (err, rows) => {
		rows.recordset.forEach( row => { 
			let runEntryID = row.InstanceID;
			let methodName = row.MethodName;
			let stepName = row.ProcessName;
			let timeElapsed = row.ElapsedTime;
			if(stepName == "End Of Method" || stepName == "Start Of Method" || !timeElapsed) { return; }
			let methodInfo = cyclesLibrary.find( method => method.name === methodName);
			if(!methodInfo) { 
				let newMethod = { 
					name: methodName,
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
				console.log(stepInfo);
			}
			stepInfo.times.push(timeElapsed);
		});
		//Calculate Averages
		let ostream = fs.createWriteStream(`${__dirname}/public/runtimeLibrary.txt`);
		ostream.once('open', fd => {
			ostream.write("*****DATA GENERATED AT " + new Date(Date.now()) + "*****\n");
			cyclesLibrary.forEach( method => {                                                                        	
			       	method.stepsAndTimes.forEach( step => {
		        		const sum = step.times.reduce( (a,b) => a + b, 0);
		        		const avg = (sum / step.times.length) || 0;
					const median = sum;
		        		ostream.write(method.name + "," + avg + "," + step.name + "," + step.times.length + "," + avg + "\n");
		        	});
		        });
		})

	});
	res.redirect(200, 'https://nyscf-dashboard.org');
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
	res.status(200).send()	
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
				let methodInfo = methods.find( 
					method => (method.MethodType === methodType && method.MethodCode === methodCode)
				);
				if(!methodInfo){
					let newMethodTypeObject = {
						MethodType: methodType,
						MethodCode: methodCode,
						MethodSystem: methodSystem,
						Processes: []
					};
					let newProcessObject = {
						ProcessName: row.ProcessName,
						WorklistTaskName: row.TableLoopName,
						TaskOrder: row.TableLoopPosition,
						ProcessOrder: row.TableProcessPosition,
						IsTracked: row.IsTracked,
						NTRUsage: row.NTRUsage,
						Usage1000uL: row.Usage1000UL,
						Usage300uL: row.Usage300UL
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
						Usage300uL: row.Usage300UL
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
	//console.log("Changing steps for method: " + req.body.MethodType + " " + req.body.SystemNumber);
	let query = "BEGIN TRANSACTION " +
		"DELETE FROM MethodProcesses WHERE MethodType = \'" + req.body.MethodType + "\' AND MethodCode = \'" + req.body.MethodCode + "\'; ";
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
					"SystemNumber) " +
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
					req.body.SystemNumber + ") ";
	});

	query += "COMMIT";
	let request = new sql.Request(dashboardPool);
	const result = await request.query(query);

	res.status(200).send();
});


app.get("/api/getRunEntries", async function(req, res) {
	requestCount++;
	let dateString = req.query.year + "-" + req.query.month + "-" + req.query.day + " 00:00:00.000";
	let query = "SELECT " + 
				"RunInstance.EntryID, RunInstance.MethodName, RunInstance.CreatedAt, RunInstance.LastUpdated, " +
				"RunInstance.SystemID, RunInstance.StatusOfRun, RunProcess.SourceBarcode, " + 
				"RunProcess.ProcessDetails, RunProcess.IsComplete, RunProcess.DestinationBarcode " + 
				"FROM RunInstance " +
				"INNER JOIN RunProcess ON RunProcess.InstanceID = RunInstance.EntryID " +
				"WHERE RunInstance.CreatedAt > DATEADD(HOUR, -96, \'" + dateString + 
					"\') AND RunInstance.CreatedAt < DATEADD(HOUR, 96, \'" + dateString + "\');"

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
			"Lookup_ArrayMethods.MethodName, MethodReservations.SystemID, MethodReservations.DateCreated " +
			"FROM MethodReservations " + 
				"INNER JOIN Lookup_ArrayMethods ON Lookup_ArrayMethods.MethodID = MethodReservations.MethodID " +
			"WHERE MethodReservations.DateCreated > DATEADD(HOUR, -96, \'" + 
				dateString + "\') AND MethodReservations.DateCreated <  DATEADD(HOUR, 96, \'" + dateString + "\');";
	try{
		const request = new sql.Request(nyscfPool);
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

app.get("/api/generateAverageRunTimesForLabLims", async function(req, res, next) {

	requestCount++;

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
		let avg = sum / count ;
		res.json(avg);
	}
	catch(err){
		console.log(err + "\n**Error with /generateExpectedRuntimeOfMethodCode");
	}
});

/**TEST ROUTES FOR CALENDAR SCHEDULING END**/

io.use(function(socket, next){
	numOfConnections++;
	next();
});

io.on("connection", socket => {

	var query = "SELECT " +
				"RunInstance.MethodName, RunInstance.EntryID, RunInstance.CurrentStep, RunInstance.StatusOfRun, " + 
				"RunInstance.SystemID, RunProcess.StartedAt, RunInstance.IsActive, RunInstance.SimulationOn, RunInstance.NTRCount, " + 
				"RunInstance.COUNT1000UL, RunInstance.COUNT300UL, RunInstance.CAPACITY1000UL, RunInstance.CAPACITY300UL, " +
				"RunProcess.ProcessName, RunProcess.SourceBarcode, RunProcess.IsComplete, RunInstance.NTRCapacity, " + 
				"RunProcess.RunProcessID, RunInstance.CurrentProcessID, RunProcess.IsTracked, RunInstance.MethodCode, " + 
				"RunProcess.RequiredNTRTips, RunProcess.Required1000ULTips, RunProcess.Required300ULTips " +
				"FROM RunInstance " +
				"INNER JOIN RunProcess ON RunProcess.InstanceID = RunInstance.EntryID " +
				"WHERE RunInstance.CreatedAt > DATEADD(HOUR, -24, GETDATE());";

	let userConnectionID = setInterval( async () => {
		let request = new sql.Request(dashboardPool);
		const result = request.query(query, function(err, rows){
			if(err) {
				console.log(err);
				throw err;
			}
			socket.emit('showrows', rows.recordset);
		});
		
	}, 5000);

	socket.on("disconnect", () => {
		console.log("client disconnected "+ userConnectionID);
		numOfConnections--;
		clearInterval(userConnectionID);
	});
});


//API will land here on error
app.use(function(req, res, next){
	console.log("URL requested and not found:" + req.originalUrl);
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

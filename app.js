var express = require('express');
var bodyParser = require('body-parser');
var sql = require('mssql');
const sql2 = require('mssql');
var http = require('http');
var socketIo = require("socket.io");
var fs = require('fs');
var Filereader = require('filereader');
var bodyParser = require('body-parser');
var runBuilder = require('utils');

var app = express();

app.use(function (req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, contentType, Content-Type, Accept, Authorization");
	next();
});

var port = process.env.port || 4000;
var requestCount = 0;

var server = app.listen(port, () => {
	console.log("Running on port ", port);
});

var io = socketIo(server);

let requestsCountMessage = setInterval( () => {
	console.log("Requests received this interval: " + requestCount);
	requestCount = 0;
}, 5000);

var dbConfig = {
	user: "nyscf",
	password: "nyscfadmin",
	server: "nyscf-dashboard.comgzynzse2f.us-east-1.rds.amazonaws.com",
	database: "dashinfo"
};

var sqlconnect = sql.connect(dbConfig, function(err){
	if(err) console.log(err);
});

var nyscfDBConfig = {
	user: "sa",
	password: "Suite450",
	server: "52.44.45.242",
	database: "NYSCF_Dev"
};

const pools = {};

async function getPool(name, config) {
	if(!Object.prototype.hasOwnProperty.call(pools, name)) {
		const pool = new sql2.ConnectionPool(config);
		const close = pool.close.bind(pool);
		pool.close = (...args) => {
			delete pools[name];
			return close(...args);
		}
		await pool.connect();
		pools[name] = pool;
	}
	return pools[name];
}


app.use(express.static('public'));

app.get('/api/info', (req, res) => {
	requestCount++;
	const file = `${__dirname}/public/runtimeLibrary.txt`;
	res.download(file);
});

var jsonParser = bodyParser.json();

app.post('/api/submitWorklist', jsonParser, async function(req, res) {
	requestCount++;
	let query;
	console.log(req.body.MethodCode);
	query = await runBuilder.generateQueryString(req.body.MethodCode, req.body);
	let request = new sql.Request();
	const submissionID = await request.query(query);
	//parsing of submissionID is due to the way the SQL query returns json object. (a single element array with empty string key)
	console.log("Generated RunID is: " + submissionID[0][""]);
	res.status(200).json({"RunID" : submissionID[0][""]});
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
	let request = new sql.Request();
	try{
		const result = await request.query(query);
		console.dir(result + "\nReadout of result");	
	}
	catch(err){
		console.log(err + "\n**ERRROR**");
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
	let request = new sql.Request();
	const result = await request.query(query);
	res.status(200).send();
});

app.post("/api/updateNTRCount", jsonParser, async function(req, res) {
	//console.log("Receiving request to update tip count for System " + req.body.SysNum + " to " + req.body.TipsLeft + "/" + req.body.NTRCapacity);
	requestCount++;
	let query = "BEGIN TRANSACTION " +
			"UPDATE RunInstance SET " +
				"NTRCount = " + req.body.CountNTR + ", " +
				"NTRCapacity = " + req.body.CapacityNTR + ", " +
				"COUNT1000UL = " + req.body.Count1000uL + ", " +
				"CAPACITY1000UL = " + req.body.Capacity1000uL + ", " +
				"COUNT300UL = " + req.body.Count300uL + ", " +
				"CAPACITY300UL = " + req.body.Capacity300uL +
			" WHERE EntryID = " + req.body.RunID + ";" +
      		    "COMMIT";

//	const pool = await getPool('mdash', dbConfig);
//	console.log("POOL: \n\n\n\n\n" + pool);
//	const result = await pool.request().query(query);


	let request = new sql.Request();
	const result = await request.query(query);
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
	let request = new sql.Request();
	const result = await request.query(query);
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

	let request = new sql.Request();
	request.query(query, (err, rows) => {
		rows.forEach( row => { 
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
					const median = runBuilder.median(step.times);
		        		ostream.write(method.name + "," + avg + "," + step.name + "," + step.times.length + "," + median + "\n");
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

	let request = new sql.Request();
	request.query(query, (err, rows) => {
		if(err) console.log(err);
		rows.forEach( row => {
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

});

app.get("/api/getMethodTemplates.json", function(req, res){

	requestCount++;
	let query = "SELECT * FROM MethodProcesses";
	let methods = [];
	let request = new sql.Request();
	request.query(query, (err, rows) => {
		if(err) console.log(err);
		rows.forEach( row => {
			let methodType = row.MethodType;
			let methodSystem = row.SystemNumber;
			let methodCode = row.MethodCode;
			let methodInfo = methods.find( method => (method.MethodType === methodType && method.MethodCode === methodCode));
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
	//const pool = await getPool('mdash', dbConfig);
	//console.log("POOL: \n\n\n\n\n" + pool);
	//const result = await pool.request().query(query);

	let request = new sql.Request();
	const result = await request.query(query);

	res.status(200).send();
});


app.get("/api/getRunEntries", async function(req, res) {
	requestCount++;
	let dateString = req.query.year + "-" + req.query.month + "-" + req.query.day + " 00:00:00.000";
	let query = "SELECT " + 
				"RunInstance.EntryID, RunInstance.MethodName, RunInstance.CreatedAt, RunInstance.LastUpdated, " +
				"RunInstance.SystemID, RunInstance.StatusOfRun, RunProcess.SourceBarcode, RunProcess.ProcessDetails, " + 
				"RunProcess.IsComplete, RunProcess.DestinationBarcode " + 
				"FROM RunInstance " +
				"INNER JOIN RunProcess ON RunProcess.InstanceID = RunInstance.EntryID " +
				"WHERE RunInstance.CreatedAt > DATEADD(HOUR, -96, \'" + dateString + "\') AND RunInstance.CreatedAt < DATEADD(HOUR, 96, \'" + dateString + "\');"

	const pool = await getPool('mdash', dbConfig);
	console.log("POOL: \n\n\n\n\n" + pool);
	const result = await pool.request().query(query);
//	let request = new sql.Request();
//	const result = await request.query(query);
	res.status(200).send(result);
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

	let userConnectionID = setInterval( () => {
		var request = new sql.Request();
		request.query(query, function(err, rows){
			if(err)
				throw err;
			//console.log('SOCKET STATUS: Sent data to user' + new Date(Date.now()));
			socket.emit('showrows', rows);
		});
	}, 5000);
	console.log("UserID " + userConnectionID + " connected at: " + new Date(Date.now()));
	socket.on("disconnect", () => {
		console.log("client disconnected "+ userConnectionID);
		clearInterval(userConnectionID);
	});
});


//API will land here on error
app.use(function(req, res, next){
	let e = new Error("Not Found");
	console.log(e);
	console.log(req);
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

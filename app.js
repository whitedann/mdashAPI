var express = require('express');
var bodyParser = require('body-parser');
var sql = require('mssql');
var http = require('http');
var socketIo = require("socket.io");
var fs = require('fs');
var Filereader = require('filereader');

var app = express();

app.use(function (req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, contentType, Content-Type, Accept, Authorization");
	next();
});

var port = process.env.port || 3300;

var server = app.listen(port, () => {
	console.log("Running on port ", port);
});
var io = socketIo(server);

var dbConfig = {
	user: "nyscf",
	password: "nyscfadmin",
	server: "nyscf-dashboard.comgzynzse2f.us-east-1.rds.amazonaws.com",
	database: "dashinfo"
}


var sqlconnect = sql.connect(dbConfig, function(err){
	if(err) console.log(err);
});

app.use(express.static('public'));

app.get('/info', (req, res) => {
	const file = `${__dirname}/public/runtimeLibrary.txt`;
	res.download(file);
});


app.get("/generateruntimedata", (req, res) => {
	let query = "SELECT RunProcess.InstanceID, " +
		              "RunInstance.MethodName, " +
		              "DATEDIFF(second, RunProcess.StartedAt, LEAD(RunProcess.StartedAt) OVER (ORDER BY RunProcess.RunProcessID)) AS ElapsedTime, " +
		              "RunProcess.ProcessName " +
		       "FROM RunInstance " +
		       "INNER JOIN RunProcess ON RunInstance.EntryID = RunProcess.InstanceID " +
		       "WHERE RunInstance.isActive = 0" +
		       "AND RunInstance.CreatedAt > DATEADD(DAY, -20, GETDATE()) " +
		       "AND RunInstance.StatusOfRun = \'Finished\' "; //+
		       //"AND RunInstance.SimulationOn = 1;";

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
		        		ostream.write(method.name + "," + avg + "," + step.name + "," + step.times.length + "\n");
		        	});
		        });
		})

	});
	res.send();
});


app.get("/:methodName", function(req, res){
	console.log(req.params.methodName);
	fs.readFile('NYSCFLOGS/data.txt', (e, data) => {
		if(e) throw e;
		res.send(data);
	})
});



io.on("connection", socket => {
	console.log("user connected");

	var query = "SELECT RunInstance.MethodName, RunInstance.EntryID, RunInstance.CurrentStep, RunInstance.StatusOfRun, RunInstance.SystemID, RunProcess.StartedAt, RunInstance.IsActive, RunProcess.ProcessName, RunProcess.SourceBarcode, RunProcess.IsComplete, RunProcess.TipCountWhenThisStepStarted, RunProcess.NTRTipCapacity FROM RunInstance " +
		"INNER JOIN RunProcess ON RunProcess.InstanceID = RunInstance.EntryID " +
		"WHERE RunInstance.CreatedAt > DATEADD(HOUR, -8, GETDATE()) " +
		"AND RunInstance.SimulationOn = 1;";

	let userConnectionID = setInterval( () => {
		var request = new sql.Request();
		request.query(query, function(err, rows){
			if(err)
				throw err;
			console.log('Data recieved and emitted ' + new Date(Date.now()));
			socket.emit('showrows', rows);
		});
	}, 5000);
	socket.on("disconnect", () => {
		console.log("client disconnected " + userConnectionID.toString());
		clearInterval(userConnectionID);
	});
});

//API will land here on error
app.use(function(req, res, next){
	let e = new Error("Not Found");
	console.log(e);
	e.status = 404;
	next(e);
});

app.use(function(e, req, res, next) {
	if(e.status = 404){
		res.send('notFound');
	}
	else {
		res.json({
			error: e.message
		});
	}
});

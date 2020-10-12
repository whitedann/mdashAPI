var sql = require('mssql');

let nyscfDBConfig = {

	user: "sa",
	password: "Suite450",
	server: "52.44.45.242",
	database: "NYSCF_Dev"
}

const nyscfPool = new sql.ConnectionPool(nyscfDBConfig);

async function testNYSCF() {
	let query = "SELECT TOP (10) * FROM MethodReservations";
	let request = new sql.Request(nyscfPool);
	let result = await request.query(query);
	console.log("NYSCF TEST: " + result.recordset.length + "\n");
}

async function testAll(){
	await nyscfPool.connect();
	await testNYSCF();
}

testAll()


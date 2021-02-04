module.exports = class EmitTimer {

	constructor(functionToRun, interval){
		this.timerInterval = interval;
		this.timerFunction = functionToRun;
		this.timerObj = setInterval( this.timerFunction , interval);
	}

	stopTimer(){
		if(this.timerObj){
			clearInterval(this.timerObj);
			this.timerObj = null;
		}
	}

	startTimer(){
		let rand = Math.random();
		if(!this.timerObj){
			this.stopTimer();
			this.timerObj = setInterval( this.timerFunction , this.timerInterval);
		}

	}

	resetTimer(){
		if(this.timerObj){
			console.log("Reseting Timer");
			this.stopTimer();
			this.startTimer();
		}
	}

}

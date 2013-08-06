
var requirebox = require('./../main')

var coreStubs = {
	fs: __dirname+'/fs-stub.js',
	path: __dirname+'/path-stub.js'
}

//you can use this to redirect require calls to new paths
function fileCb(path, sourcePath, sourceSrc){
	if(coreStubs[path]){
		console.log('stubbed core module: ' + path)
		return coreStubs[path]
	}
}

function includeCb(name, path, src, sourcePath, sourceSrc){
	console.log(sourcePath + ' required ' + name + ' -> ' + path)  
}

function beforeFileCb(){
}

requirebox('./ex', module.filename, fileCb, includeCb, beforeFileCb)


var fs = require('fs')
var resolve = require('resolve')
var pathModule = require('path')

function resolveSync(reqName, baseDir){
	if(typeof(reqName) !== 'string') throw new Error('not a string: ' + reqName)
	if(typeof(baseDir) !== 'string') throw new Error('not a string: ' + baseDir)
	return resolve.sync(reqName, {basedir: baseDir})
}

function Req(reqName, baseDir, fileCb, includeCb, beforeResolveCb, srcCb){
	this.fileCb = fileCb
	this.includeCb = includeCb
	this.beforeResolveCb = beforeResolveCb
	this.srcCb = srcCb
	this.srcCache = {}
	this.cache = {}
	this.cachedGeneratedPaths = {}
	this.filesToWrite = []

	this.rootModule = this.recurse(reqName, baseDir)
	
}

Req.prototype.getSrc = function(resolvedPath){
	var src = this.srcCache[resolvedPath]
	if(src === undefined){
		src = fs.readFileSync(resolvedPath, 'utf8')
		this.srcCache[resolvedPath] = src
	}
	return src
}

Req.prototype.recurse = function(reqName, baseDir, sourcePath, sourceSrc){

	var allowedToGenerate = true
	
	if(this.beforeResolveCb){
		var res = this.beforeResolveCb(reqName, sourcePath, sourceSrc)
		if(res){
			//console.log(JSON.stringify(res))
			if(res.noGeneration) allowedToGenerate = false
			if(!res.path) throw new Error('must provide path(' + reqName+') if overriding resolve: ' + JSON.stringify(res) + ' ' + this.beforeResolveCb)
			reqName = res.path
			if(!allowedToGenerate){
				return {__resolvedPath: reqName}
			}
		}
		
	}

	try{
		//console.log(JSON.stringify([reqName, baseDir]))
		
		var didReplace = false
		
		try{
			var resolvedPath = resolveSync(reqName, baseDir)
	
			var isCore = resolve.isCore(resolvedPath)
			
			var replacementPath = this.fileCb(resolvedPath, sourcePath, sourceSrc, isCore)
			if(replacementPath.indexOf('pagemodule') !== -1){
				console.log('here: ' + resolvedPath + ' ' + replacementPath + ' ' + isCore)
			}

			if(isCore){
				if(!replacementPath){
					console.log('WARNING: fileCb did not return a replacement path for core module: ' + resolvedPath + ' included in ' + sourcePath)
					return
				}
				return {__resolvedPath: resolvedPath}
			}

			if(replacementPath){
				resolvedPath = replacementPath
				didReplace = true
			}
			
		}catch(e){
			if(!resolvedPath){
				console.log('WARNING: fileCb did not return a replacement path for module: ' + reqName)				
				return
			}
		}

		
		var key = resolvedPath+':'+sourcePath
		//console.log('key: ' + key)
		if(this.cache[key]){
			console.log('returning cached ' + key)
			return this.cache[key]
		}

		var src = this.getSrc(resolvedPath)
		
		
		this.includeCb(reqName, resolvedPath, src, sourcePath, sourceSrc)
		
		var resolvedBaseDir = pathModule.dirname(resolvedPath)

		var moduleWrapper = {}		
		this.cache[key] = moduleWrapper
		if(didReplace || resolvedPath.indexOf('.0.') !== -1){
			moduleWrapper.__resolvedPath = resolvedPath
			console.log('returning .0. : ' + resolvedPath + ' for key ' + key)
			return moduleWrapper
		}
		var generatedPath = this.cachedGeneratedPaths[resolvedPath]
		if(!generatedPath){
			//console.log('generating for ' + resolvedPath)

			generatedPath = this.cachedGeneratedPaths[resolvedPath] = 
				'./'+pathModule.basename(resolvedPath)+'.'+Math.random()+'.js'
				//'./'+pathModule.basename(resolvedPath)+'.js'
			this.parse(src, resolvedBaseDir, resolvedPath, allowedToGenerate?generatedPath:undefined, this.srcCb)
		}
		moduleWrapper.__resolvedPath = generatedPath

		return moduleWrapper
		
	}catch(e){
		throw e
	}
}

Req.prototype.generate = function(duringCb){
	var folder = process.cwd()+'/.generated.'+Math.random()+'/'

	
	try{
		fs.mkdirSync(folder)//'/.generated')
	}catch(e){
		if(!e.code === 'EEXIST') throw e
	}

	duringCb(folder)

	this.filesToWrite.forEach(function(f){
		fs.writeFileSync(folder+f.name, f.src, {mode: 0444})
	})
	
	return folder+this.rootModule.__resolvedPath
}

Req.prototype.parse = function(src, baseDir, srcPath, generatedPath, srcCb){
	var has = {}
	var lines = src.split('\n');
	for(var i=0;i<lines.length;++i){
		var line = lines[i];
		if(lineIsRequire(line)){
			var reqStr = extractReqFromLine(line)
			var resolvedPath = undefined
			if(reqStr && !has[reqStr]){
				has[reqStr] = true
				var res = this.recurse(reqStr, baseDir, srcPath, src)
				//if(reqStr[0] === ':') console.log(reqStr + ' res ' + JSON.stringify(res))
				if(res){
					resolvedPath = res.__resolvedPath
					has[reqStr] = resolvedPath
				}
			}else{
				resolvedPath = has[reqStr]
			}

			if(resolvedPath && resolvedPath.indexOf('pagemodule') !== -1){
				//console.log(reqStr + ' ' + line)
			}else if(!resolvedPath){
				//throw new Error('TODO: ' + reqStr)
				//console.log('*resolvedPath: ' + reqStr)
				resolvedPath = reqStr
			}

			var ReqStr = 'require('
			var si = line.indexOf(ReqStr)+ReqStr.length
			lines[i] = line.substr(0, si)+'"'+resolvedPath+'")' + line.substr(line.indexOf(')', si)+1)
		}
	}

	if(generatedPath){
		var resultSrc = lines.join('\n')
		
		if(srcCb){
			var t = srcCb(srcPath, resultSrc)
			if(t) resultSrc = t
		}
		
		//fs.writeFileSync(generatedPath, resultSrc, {mode: 0444})
		this.filesToWrite.push({name: generatedPath, src: resultSrc})
	}else{
		var module = require(srcPath)
		module.__resolvedPath = srcPath
		return module
	}
}

function req(reqName, baseDir, fileCb, includeCb, beforeResolveCb, srcCb){
	if(arguments.length < 5) throw new Error('requirebox takes 5-6 arguments, e.g. requirebox("underscore", __dirname,  fileCb, includeCb, beforeFileCb, [srcCb])')
	if(typeof(reqName) !== 'string') throw new Error('first argument must be a string, but is a ' + typeof(reqName))
	if(typeof(baseDir) !== 'string') throw new Error('second argument must be a string, but is a ' + typeof(baseDir))
	if(typeof(fileCb) !== 'function') throw new Error('third argument must be a function, but is a ' + typeof(fileCb))
	if(typeof(includeCb) !== 'function') throw new Error('fourth argument must be a function, but is a ' + typeof(includeCb))
	if(typeof(beforeResolveCb) !== 'function') throw new Error('fifth argument must be a function, but is a ' + typeof(beforeResolveCb))
	
	var req = new Req(reqName, baseDir, fileCb, includeCb, beforeResolveCb, srcCb)
	var path = req.rootModule.__resolvedPath
	//return require(path)
	return function(duringCb){
		var path = req.generate(duringCb)
		return path
	}
	//}
}

module.exports = req

function extractReqFromLine(line){
	var ri = line.indexOf('require(') + 'require('.length;
	var re = line.indexOf(')', ri)
	var reqString = line.substring(ri, re)
	reqString = reqString.trim()

	if((reqString.charAt(0) !== '"' && reqString.charAt(0) !== "'") || (reqString.charAt(reqString.length-1) !== '"' && reqString.charAt(reqString.length-1) !== "'")){
		throw new Error('cannot parse non-literal require statement: ' + line)
	}

	reqString = reqString.substr(1, reqString.length-2)
	
	return reqString
}

function requireNotQuoted(line){
	var c
	var insideQuotes = false
	for(var i=0;i<line.length;++i){
		c = line[i]
		if(c === '"'){
			insideQuotes = !insideQuotes
		}
		if(!insideQuotes && c === 'r' && line.indexOf('require(') === i) return true
	}
	return false
}

function lineIsRequire(line){
	var ri = line.indexOf('require(')
	var ci = line.indexOf('//')
	//var qi = line.indexOf('"')
	if(ri !== -1 && (ci === -1 || ci > ri)){// && (qi === -1 || qi > ri)){
		return requireNotQuoted(line)
	}
}


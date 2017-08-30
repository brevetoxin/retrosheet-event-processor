'use strict';
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require("fs"));
var uuid = require('node-uuid');
var dir = Promise.promisifyAll(require('node-dir'));
var request = require('request-promise');


var logger, config, eventBus;
var boxscore = {};

function processFiles(files) {
    return processFile(files.pop())
      .then(function(result) {
        if(files.length < 1) {
          return;
        } else {
          return processFiles(files);
        }
      });
}

function getGameByRetroId(id) {
  var options = {
    url: config.apiUrl + '/' + id,
    headers: {
      'content-type': 'application/json'
    },
    method: 'GET'
  }
  return request(options);
}

function processFile(file) {
  return importEventFile(file)
    .then(function (data) {
      return separateGames(data);
    })
    .then(function (games) {
      var gamePromises = games.map(function(game) {
        return getGameByRetroId(game.id)
        .then(function(result) {
          return result;
        })
        .catch(function (result) {
          if(result.statusCode == 404) {
            var options = {
              url: config.apiUrl,
              headers: {
                'content-type': 'application/json'
              },
              method: 'POST',
              body: game,
              json: true
            };
            return request(options)
             .catch(function(err) {
               console.log(game.id);
               process.exit();
             });
          } else {
            console.log(result);
            throw error(result);
          }
        });
      })
      return Promise.all(gamePromises);
    })
    .catch(function (error) {
        console.log(error);
        throw new Error(error);
    })
}

function calculateBoxScore(game) {
  boxscore = {};
  game.plateAppearances.forEach(function(pa) {
      if(!boxscore[pa.player]) {
        boxscore[pa.player] = {};
      }
      for (var key in pa) {
        if(key !== 'player') {
          if(!boxscore[pa.player][key]) {
              boxscore[pa.player][key] = parseInt(pa[key]);
          } else {
              boxscore[pa.player][key] += parseInt(pa[key]);
          }
        }
      }
  })

  return boxscore;

}

function sortRunners(runner1, runner2) {
  var runner1Origin = runner1[0] == 'B' ? 0 : runner1[0];
  var runner2Origin = runner2[0] == 'B' ? 0 : runner2[0];
  return runner1Origin < runner2Origin;
}

function sortStolenBases(runner1, runner2) {
  var runner1Origin = runner1[2] - 1;
  var runner2Origin = runner2[2] - 1;
  return runner1Origin < runner2Origin;
}

function handleStolenBaseAttempts(gameInfo, play) {
  var parts = play.split(';');
  parts.sort(sortStolenBases);
  var runnerSplit = play.split(/\.|;/g);
  var originBases = [], attemptedBase;
  runnerSplit.forEach(function(split) {
    originBases.push(split[0]);
  })
  for (var i=0; i < parts.length; i++) {
    if(parts[i].match(/SB/) || parts[i].match(/CS/)) {
      var caught = parts[i].match(/CS/);
      if(caught) {
        caught = 1;
      } else {
        caught = 0;
      }
      var error = parts[i].match(/E/);
      var attemptedBase = parts[i].match(/CS[1-3H]|SB[1-3H]/)[0][2];
      if(attemptedBase === 'H') {
          attemptedBase = 4;
          gameInfo = recordStolenBaseAttempt(gameInfo.bases[3], gameInfo, caught);
          if(originBases.indexOf((attemptedBase - 1).toString()) < 0) {
            if(!caught || error) {
              gameInfo.bases[3].r = 1
              gameInfo.plateAppearances.push(gameInfo.bases[3]);
            }
            gameInfo.bases[3] = null;
          }
      } else {
          gameInfo = recordStolenBaseAttempt(gameInfo.bases[attemptedBase - 1], gameInfo, caught);
          if(originBases.indexOf(((attemptedBase - 1).toString())) < 0) {
            if(!caught || error) {
              if(!play.match(/\./)) {
                play = play + '.';
              } else {
                play = play + ';';
              }
              play = play + (attemptedBase - 1).toString() + '-' + attemptedBase;
            } else {
              gameInfo.bases[attemptedBase - 1] = null;
            }
          }
      }
    }
  }
  return {
    gameInfo: gameInfo,
    play: play
  };
}

function exportGameToFile(game) {
    fs.writeFileAsync('game.json', JSON.stringify(game))
    .then(function(result) {
      return result;
    })
}

function getMOB(bases) {
    var mob = 0;
    for(var i = 1; i < bases.length; i++) {
      if(bases[i]) {
        mob ++;
      }
    }
    return mob;
}

function getBattingPosition(lineup, playerId) {
  return parseInt(lineup[playerId].battingPosition);
}

function importEventFile(file) {
  return fs.readFileAsync(file, 'utf-8')
  .then(function (data) {
    return data.split(/\r?\n/);
  })
}

function resetInning(gameInfo) {
    gameInfo.bases.forEach(function (data) {
      if(data) {
        gameInfo.plateAppearances.push(data);
      }
    })
    gameInfo.bases[0] = null;
    gameInfo.bases[1] = null;
    gameInfo.bases[2] = null;
    gameInfo.bases[3] = null;
    gameInfo.outs = 0;
    return gameInfo;
}

function recordER(gameInfo, pitcher, er) {
  if(!gameInfo.pitchers[pitcher]) {
    gameInfo.pitchers[pitcher] = {};
  }
  gameInfo.pitchers[pitcher].er = er;
  return gameInfo;
}

function recordOut(gameInfo) {
  var pitchingTeam = 1 - gameInfo.battingTeam;
  if(!gameInfo.pitchers[gameInfo.lineup[pitchingTeam].pitcher]) {
    gameInfo.pitchers[gameInfo.lineup[pitchingTeam].pitcher] = {};
    gameInfo.pitchers[gameInfo.lineup[pitchingTeam].pitcher].outs = 1;
  } else {
    gameInfo.pitchers[gameInfo.lineup[pitchingTeam].pitcher].outs ++;
  }
  gameInfo.outs ++;
  return gameInfo;
}

function recordStolenBaseAttempt(runner, gameInfo, caught) {
  var sb = {};
  var pitchingTeam = 1 - gameInfo.battingTeam;
  sb.pitcher = gameInfo.lineup[pitchingTeam].pitcher;
  sb.catcher = gameInfo.lineup[pitchingTeam].catcher;
  sb.runner = runner.player;
  sb.caught = caught;

  gameInfo.stolenBases.push(sb);
  return gameInfo;
}

function advanceRunners(play, gameInfo) {
    gameInfo.currentBase = 0;
    var runsScored = 0;
    var parts = play.split('.');
    var runners = [];
    if (parts.length > 1) {
//        if(parts[1].match(/(E+?.)/)) {
//          parts[1] = parts[1].replace('X', '-');
//        }
        //parts[1] = parts[1].replace(/\(.+?\)/g, '');
        parts[1] = parts[1].replace(/#/g, '');
        runners = parts[1].split(';');
        runners.sort(sortRunners);
        var basePositions;
        for (var i = 0; i < runners.length; i++) {
            if(runners[i].match(/(E+?.)/)) {
              runners[i] = runners[i].replace('X', '-');
            }
            runners[i] = runners[i].replace(/\(.+?\)/g, '');
            if(runners[i][1] === 'X'){
                basePositions = runners[i].split('X');
                gameInfo = recordOut(gameInfo);
                gameInfo.bases[basePositions[0]] = null;
                eventBus.trigger('runnerChange', gameInfo, { runner: basePositions[0], result: 'O' });
            } else {
                basePositions = runners[i].split('-');
                if (basePositions[0] === 'B') {
                    gameInfo.bases[basePositions[1]] = gameInfo.bases[0];
                    gameInfo.currentBase = basePositions[1];
                } else {
                    if (basePositions[1] === 'H') {
                        gameInfo.bases[basePositions[0]].r = 1;
                        gameInfo.plateAppearances.push(gameInfo.bases[basePositions[0]]);
                        runsScored++;
                        eventBus.trigger('runnerChange', gameInfo, { runner: basePositions[0], result: 'H' });
                    } else {
                        gameInfo.bases[basePositions[1]] = gameInfo.bases[basePositions[0]];
                        eventBus.trigger('runnerChange', gameInfo, { runner: basePositions[0], result: basePositions[1] });
                    }
                    if(basePositions[0] !== basePositions[1]) {
                      gameInfo.bases[basePositions[0]] = null;
                    }
                }
            }
        }
    }
    gameInfo.runsScored = runsScored;
    return gameInfo;
}


function processPlay(play, gameInfo) {
    gameInfo.currentPA.h = 0;
    gameInfo.currentPA['2b'] = 0;
    gameInfo.currentPA['3b'] = 0;
    gameInfo.currentPA.hr = 0;
    gameInfo.currentPA.sb = 0;
    gameInfo.currentPA.r = 0;
    gameInfo.currentPA.rbi = 0;
    gameInfo.currentPA.o = 0;
    gameInfo.currentPA.hbp = 0;
    gameInfo.currentPA.bb = 0;
    gameInfo.currentPA.so = 0;
    gameInfo.currentPA.inningOuts = gameInfo.outs;
    gameInfo.currentPA.mob = getMOB(gameInfo.bases);
    gameInfo.currentPA.battingPosition = getBattingPosition(gameInfo.lineup[gameInfo.battingTeam], gameInfo.currentPA.player);
    var pitchingTeam = 1 - gameInfo.battingTeam;
    gameInfo.currentPA.pitcher = gameInfo.lineup[pitchingTeam].pitcher;
    gameInfo.bases[0] = gameInfo.currentPA;
    gameInfo.currentBase = 0;
    if (play[0] === "S" && play[1] != 'B') {
        // single
        gameInfo.bases[0].h = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
        eventBus.trigger('play', gameInfo, 'S');
    } else if (play[0] === "D" && play[1] != 'I') {
        // Double
        gameInfo.bases[0]['2b'] = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[2] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
        eventBus.trigger('play', gameInfo, 'D');
    } else if (play[0] === "T") {
        // Triple
        gameInfo.bases[0]['3b'] = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[3] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
        eventBus.trigger('play', gameInfo, 'T');
    } else if ((play.match(/(E.?)/) || play.match(/([1-9]E[1-9])/)) && !play.match(/POCS/)) {
        var handlerObject = handleStolenBaseAttempts(gameInfo, play);
        gameInfo = handlerObject.gameInfo;
        play = handlerObject.play;
        gameInfo = advanceRunners(play, gameInfo);
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play.match(/(HR|H[1-9]|H\/)/) && !play.match(/TH/) && !play.match(/SH/) && !play.match(/SBH/)) {
        // Home run
        gameInfo.bases[0].hr = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[0].rbi = gameInfo.runsScored;
        gameInfo.bases[0].rbi++;
        gameInfo.bases[0].r = 1;
        gameInfo.plateAppearances.push(gameInfo.bases[0]);
        gameInfo.bases[0] = null;
        eventBus.trigger('play', gameInfo, 'HR');
    } else if (play.match(/(HP)/)) {
        gameInfo.bases[0].hbp = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
        eventBus.trigger('play', gameInfo, 'HBP');
    } else if (play[0] === "C" && play[1] != 'S') {
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play[0] === "I" || (play[0] === "W" && play[1] !== "P")) {
        gameInfo.bases[0].bb = 1;
        //check for stolen base
        var handlerObject = handleStolenBaseAttempts(gameInfo, play);
        gameInfo = handlerObject.gameInfo;
        play = handlerObject.play;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[1] = gameInfo.bases[0];
        gameInfo.bases[0] = null;
        eventBus.trigger('play', gameInfo, 'BB');
    } else if (play.match(/(BK)/)) {
        gameInfo = advanceRunners(play, gameInfo);
        eventBus.trigger('play', gameInfo, 'BK');
    } else if (play.match(/^(CS)/)) {
        var handlerObject = handleStolenBaseAttempts(gameInfo, play);
        gameInfo = handlerObject.gameInfo;
        play = handlerObject.play;
        gameInfo = recordOut(gameInfo);
        gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/^(SB)/)) {
      var handlerObject = handleStolenBaseAttempts(gameInfo, play);
      gameInfo = handlerObject.gameInfo;
      play = handlerObject.play;
      gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/(DI|PB|WP|OA)/) && !play.match(/^(K)(\+.+)?/)) {
        gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/(PO)/) && !play.match(/POCS/)) {
        gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/^(K)(\+.+)?/)) {
        //check for stolen base
        var handlerObject = handleStolenBaseAttempts(gameInfo, play);
        gameInfo = handlerObject.gameInfo;
        play = handlerObject.play;
        gameInfo = advanceRunners(play, gameInfo);
        if(gameInfo.bases[0]) {
            gameInfo.bases[0].o = 1;
            gameInfo.bases[0].so = 1;
            gameInfo.plateAppearances.push(gameInfo.bases[0]);
            gameInfo.bases[0] = null;
            gameInfo = recordOut(gameInfo);
        }
    } else if (play.match(/POCS/)) {
      var handlerObject = handleStolenBaseAttempts(gameInfo, play);
      gameInfo = handlerObject.gameInfo;
      play = handlerObject.play;
      gameInfo = advanceRunners(play, gameInfo);
    } else {
        var parts = play.split('/');
        var outs = false;
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].match(/(SF|SH)/) && !play.match(/(FO)/)) {
                if(gameInfo.bases[0] && parts[i].match(/\./)) {
                  gameInfo = advanceRunners(play, gameInfo);
                  gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
                  if(gameInfo.currentBase === 0) {
                    gameInfo.plateAppearances.push(gameInfo.bases[0])
                  }
                  gameInfo.bases[0] = null;
                }
                if (parts[i].match(/(SF)/)) eventBus.trigger('play', gameInfo, 'FBO');
                else eventBus.trigger('play', gameInfo, 'GBO');
            } else if (parts[i].match(/FO|GDP|LDP|LTP|GTP/)) {
                if(gameInfo.bases[0]) {
                  gameInfo.bases[0].o = 1;
                  var playParts = play.split('.');
                  var runnersOut = playParts[0].match(/(\([1-3]\)|\(B\))/g);
                  if(!runnersOut || runnersOut.length < 1) {
                      runnersOut = [];
                      var dotSplit = parts[1].split('.');
                      if(dotSplit.length > 1) {
                        if(dotSplit[1][1] !== '-') {
                          runnersOut.push(parseInt(dotSplit[1][0]));
                        }
                      }
                  }
                  if(!runnersOut || runnersOut.length < 1) {
                    var xMatch = /([1-3H]X[1-3H])/g;
                    var matchingRunners = xMatch.exec(play);
                    matchingRunners.shift();
                    matchingRunners.forEach(function (runner) {
                      runnersOut.push(runner[0]);
                    })
                  }
                  for (var j = 0; j < runnersOut.length; j++) {
                    var cRunner = runnersOut[j][1] || runnersOut[j];
                    if(cRunner === "B") {
                        cRunner = 0;
                    }
                    gameInfo.plateAppearances.push(gameInfo.bases[cRunner]);
                    gameInfo.bases[cRunner] = null;
                    gameInfo = recordOut(gameInfo);
                  }
                  gameInfo = advanceRunners(play, gameInfo);
                  if(!play.match(/DP/)) {
                    gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
                  }
                  if(gameInfo.bases[0]) {
                    gameInfo.bases[1] = gameInfo.bases[0];
                  }
                  gameInfo.bases[0] = null;
                }
                if (parts[i].match(/FO|GDP|GTP/)) eventBus.trigger('play', gameInfo, 'GBO');
                else eventBus.trigger('play', gameInfo, 'FBO');
            } else if (play.match(/(FC.?)/)) {
                if(gameInfo.bases[0]) {
                  gameInfo.bases[0].o = 1;
                  gameInfo = advanceRunners(play, gameInfo);
                  gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
                  if(gameInfo.currentBase === 0) {
                    gameInfo.bases[1] = gameInfo.bases[0];
                  }
                  gameInfo = recordOut(gameInfo);
                  gameInfo.bases[0] = null;
                }
                eventBus.trigger('play', gameInfo, 'GBO');
            } else if (parts[i].match(/(?!^\d+$)^.+$/) && !play.match(/(FO)/) && play !== 'NP' && !play.match(/(GDP)/)){
                if(gameInfo.bases[0]) {
                  gameInfo.bases[0].o = 1;
                  gameInfo = advanceRunners(play, gameInfo);
                  gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
                  if(gameInfo.currentBase === 0) {
                    gameInfo.plateAppearances.push(gameInfo.bases[0]);
                  }
                  gameInfo = recordOut(gameInfo);
                  gameInfo.bases[0] = null;
                }
            }
        }
    }

    return gameInfo;
}



function separateGames(data) {
  var games = [];
  var currentGame = {};
  var pa = {};
  data.forEach(function (line) {
    var parts = line.split(',');
    if(parts[0] === 'id') {
      if(Object.keys(currentGame).length !== 0) {
        currentGame = resetInning(currentGame);
        games.push(currentGame);
        boxscore = {};
      }
      currentGame = {};
      currentGame.id = parts[1];
      currentGame.plateAppearances = [];
      currentGame.stolenBases = [];
      currentGame.pitchers = {};
      currentGame.outs = 0;
      currentGame.bases = [];
      currentGame.battingTeam = 0;
      currentGame.currentBase = 0;
    }

    if(parts[0] === 'info') {
      if(!currentGame.info) {
        currentGame.info = {};
      }
      currentGame.info[parts[1]] = parts[2];
    } else if (parts[0] === 'start' || parts[0] === 'sub') {
      if(!currentGame.lineup) {
        currentGame.lineup = {};
        currentGame.lineup[0] = {};
        currentGame.lineup[1] = {};
      }
      currentGame.lineup[parts[3]][parts[1]] = {
        "battingPosition": parts[4],
        "fieldingPosition": parts[5]
      };
      if(parts[5] == "1") {
        currentGame.lineup[parts[3]].pitcher = parts[1];
        if(parts[0] === 'start') {
            if(parts[3] == "0") {
              currentGame.info['visitingStarter'] = parts[1];
            } else {
              currentGame.info['homeStarter'] = parts[1];
            }
        }
      }
      if(parts[5] == "2") {
        currentGame.lineup[parts[3]].catcher = parts[1];
        if(parts[0] === 'start') {
            if(parts[3] == "0") {
              currentGame.info['visitingCatcher'] = parts[1];
            } else {
              currentGame.info['homeCatcher'] = parts[1];
            }
        }
      }
    } else if (parts[0] === 'play') {
        eventBus.trigger('newPlay', currentGame);
        if(currentGame.battingTeam !== parts[2]) {
          currentGame = resetInning(currentGame);
        }
        currentGame.battingTeam = parts[2];
        currentGame.currentPA = {};
        currentGame.currentPA.player = parts[3];
        currentGame.currentPA.team = currentGame.battingTeam;
        currentGame.currentPA.inning = parseInt(parts[1]);
        currentGame = processPlay(parts[6], currentGame);
    } else if (parts[0] === 'data' && parts[1] === 'er') {
      currentGame = recordER(currentGame, parts[2], parts[3]);
    }
  })
  currentGame = resetInning(currentGame);
  games.push(currentGame);
  return games;
  /*
  console.log("starting boxscore");
  console.log(calculateBoxScore(currentGame));
  console.log("full game log");
  console.log(currentGame);
  exportGameToFile(currentGame);
  */
}

module.exports.initialize = function(params, imports, ready) {
  logger = imports['@brevetoxin/brevetoxin-winston'];
  logger.log('info', 'mapper component initialized');
  eventBus = imports['eventBus'];
  config = params;
  dir.filesAsync(__dirname + '/' + config.resourceDirectory)
  .then(function(files) {
    files = files.filter(function (file) {
      var parts = file.split('.');
      //return parts[1] == 'EVA' || parts[1] == 'EVN';
      //return parts[0].indexOf('2016WAS') > -1;

      return parts[0].match(/1979[A-Z]{3}/);
    });
    return files;
  })
  .then(function(files) {
    //var processedFilePromises = files.map(function(file) {
      return processFiles(files);
    //})
    //return Promise.all(processedFilePromises);
  })
  .catch(function(error) {
    logger.log('error', JSON.stringify(error));
    process.exit(1);
  })
};

'use strict';
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require("fs"));
var uuid = require('node-uuid');

var logger, config;
var boxscore = {};


function calculateBoxScore(game) {
  boxscore = {};
  game.plateAppearances.forEach(function(pa) {
      if(pa.player === 'valac001') {
        console.log(pa);
      }
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

function importEventFile(file) {
  return fs.readFileAsync(__dirname + '/' + file, 'utf-8')
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
        if(parts[1].match(/(E+?.)/)) {
          parts[1] = parts[1].replace('X', '-');
        }
        parts[1] = parts[1].replace(/\(.+\)/, '');
        runners = parts[1].split(';');
        var basePositions;
        for (var i = 0; i < runners.length; i++) {
            if(runners[i][1] === 'X'){
                basePositions = runners[i].split('X');
                gameInfo = recordOut(gameInfo);
                gameInfo.bases[basePositions[0]] = null;
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
                    } else {
                        gameInfo.bases[basePositions[1]] = gameInfo.bases[basePositions[0]];
                    }
                    if(basePositions[0] !== basePositions[1]) {
                      gameInfo.bases[basePositions[0]] = null;
                    }
                }
            }
        }
    }
    console.log(gameInfo.bases);
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
    var pitchingTeam = 1 - gameInfo.battingTeam;
    gameInfo.currentPA.pitcher = gameInfo.lineup[pitchingTeam].pitcher;
    gameInfo.bases[0] = gameInfo.currentPA;
    gameInfo.currentBase = 0;
    console.log(play);
    if (play[0] === "S" && play[1] != 'B') {
        gameInfo.bases[0].h = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play[0] === "D" && play[1] != 'I') {
        gameInfo.bases[0]['2b'] = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[2] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play[0] === "T") {
        gameInfo.bases[0]['3b'] = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[3] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play.match(/^(E.?)/) || play.match(/([1-9]E3)/)) {
        gameInfo = advanceRunners(play, gameInfo);
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play.match(/(HR|H[1-9]|H\/)/)) {
        gameInfo.bases[0].hr = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[0].rbi = gameInfo.runsScored;
        gameInfo.bases[0].rbi++;
        gameInfo.bases[0].r = 1;
        gameInfo.plateAppearances.push(gameInfo.bases[0]);
        gameInfo.bases[0] = null;
    } else if (play.match(/(HP)/)) {
        gameInfo.bases[0].hbp = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play[0] === "C" && play[1] != 'S') {
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
        if(gameInfo.currentBase === 0) {
          gameInfo.bases[1] = gameInfo.bases[0];
        }
        gameInfo.bases[0] = null;
    } else if (play[0] === "I" || (play[0] === "W" && play[1] !== "P")) {
        gameInfo.bases[0].bb = 1;
        gameInfo = advanceRunners(play, gameInfo);
        gameInfo.bases[1] = gameInfo.bases[0];
        gameInfo.bases[0] = null;
    } else if (play.match(/(BK)/)) {
        gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/^(CS)/)) {
        if(play[2] === 'H') {
          gameInfo = recordStolenBaseAttempt(gameInfo.bases[3], gameInfo, true);
          gameInfo.bases[3] = null;
          gameInfo.plateAppearances.push(gameInfo.bases[3]);
        } else {
          gameInfo = recordStolenBaseAttempt(gameInfo.bases[play[2] - 1], gameInfo, true);
          gameInfo.bases[play[2] - 1] = null;
          gameInfo.plateAppearances.push(gameInfo.bases[play[2] - 1]);
        }
        gameInfo = recordOut(gameInfo);
        gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/(DI|PB|WP|OA)/)) {
        gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/(PO)/)) {
        gameInfo = advanceRunners(play, gameInfo);
    } else if (play.match(/^(SB)/)) {
        console.log(play);
        var parts = play.split(';');
        for (i=0; i < parts.length; i++) {
            if(parts[i][2] === 'H') {
                gameInfo = recordStolenBaseAttempt(gameInfo.bases[3], gameInfo, false);
                gameInfo.bases[3].r = 1
                gameInfo.plateAppearances.push(gameInfo.bases[3]);
                gameInfo.bases[3] = null;

            }  else {
                gameInfo = recordStolenBaseAttempt(gameInfo.bases[parts[i][2] - 1], gameInfo, false);
                gameInfo.bases[parts[i][2]] = gameInfo.bases[parts[i][2] - 1];
                gameInfo.bases[parts[i][2] - 1] = null;
            }
            gameInfo = advanceRunners(play, gameInfo);
        }
    } else if (play.match(/^(K)(\+.+)?/)) {
        gameInfo = advanceRunners(play, gameInfo);
        if(gameInfo.bases[0]) {
            gameInfo.bases[0].o = 1;
            gameInfo.plateAppearances.push(gameInfo.bases[0]);
            gameInfo.bases[0] = null;
            gameInfo = recordOut(gameInfo);
        }
        //check for stolen base
        var parts = play.split('+');
        if(parts[1]) {
            if(parts[1].match(/SB/)) {
              var caught = false;
            } else if (parts[1].match(/CS/)) {
              var caught = true;
            }
            var base = parts[1][2];
            if(base === 'H') {
              base = 4;
            }
            gameInfo = recordStolenBaseAttempt(gameInfo.bases[parseInt(base) - 1], gameInfo, caught);
            if(!caught) {
              if(base === 4) {
                gameInfo.plateAppearances.push(gameInfo.bases[parseInt(base) - 1]);

              } else {
                gameInfo.bases[parseInt(base)] = gameInfo.bases[parseInt(base) - 1];
                gameInfo.bases[parseInt(base) - 1] = '';
              }
            } else {
              gameInfo.plateAppearances.push(gameInfo.bases[parseInt(base) - 1]);
              gameInfo = recordOut(gameInfo);
            }
        }
    } else {
        var parts = play.split('/');
        var outs = false;
        for (var i = 0; i < parts.length; i++) {
            console.log(parts[i]);
            if (parts[i].match(/(SF|SH)/) && !play.match(/(FO)/)) {
                if(gameInfo.bases[0] && parts[i].match(/\./)) {
                  gameInfo = advanceRunners(play, gameInfo);
                  gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
                  if(gameInfo.currentBase === 0) {
                    gameInfo.plateAppearances.push(gameInfo.bases[0])
                  }
                  gameInfo.bases[0] = null;
                }
            } else if (parts[i].match(/FO|GDP|LDP|LTP|GTP/)) {
                if(gameInfo.bases[0]) {
                  gameInfo.bases[0].o = 1;
                  var runnersOut = play.match(/(\([1-3]|B\))/g);
                  if(!runnersOut) {
                      runnersOut = [];
                      var dotSplit = parts[1].split('.');
                      runnersOut.push(parseInt(dotSplit[1][0]));
                  }
                  for (var j = 0; j < runnersOut.length; j++) {
                    var cRunner = runnersOut[j][1];
                    if(cRunner === "B") {
                        cRunner = 0;
                    }
                    gameInfo.plateAppearances.push(gameInfo.bases[cRunner]);
                    gameInfo.bases[cRunner] = null;
                    gameInfo = recordOut(gameInfo);
                  }
                  gameInfo = advanceRunners(play, gameInfo);
                  gameInfo.bases[gameInfo.currentBase].rbi = gameInfo.runsScored;
                  if(gameInfo.bases[0]) {
                    gameInfo.bases[1] = gameInfo.bases[0];
                  }
                  gameInfo.bases[0] = null;
                  console.log("after");
                  console.log(gameInfo.bases);
                }
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
            } else if (parts[i].match(/(?!^\d+$)^.+$/) && !play.match(/(FO)/) && play !== 'NP'){
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
      }
      if(parts[5] == "2") {
        currentGame.lineup[parts[3]].catcher = parts[1];
      }
    } else if (parts[0] === 'play') {
        if(currentGame.battingTeam !== parts[2]) {
          currentGame = resetInning(currentGame);
        }
        currentGame.battingTeam = parts[2];
        currentGame.currentPA = {};
        currentGame.currentPA.player = parts[3];
        currentGame = processPlay(parts[6], currentGame);
    } else if (parts[0] === 'data' && parts[1] === 'er') {
      currentGame = recordER(currentGame, parts[2], parts[3]);
    }

  })
  currentGame = resetInning(currentGame);
  games.push(currentGame);
  console.log("starting boxscore");
  console.log(calculateBoxScore(currentGame));
  console.log("full game log");
  console.log(currentGame);
}

module.exports.initialize = function(params, imports, ready) {
  logger = imports['@brevetoxin/brevetoxin-winston'];
  logger.log('info', 'mapper component initialized');
  config = params;
  importEventFile(config.eventFile)
  .then(function (data) {
    separateGames(data);
  })

};

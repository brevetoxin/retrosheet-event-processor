var logger, config, eventBus;

const fs = require('fs');
const component = {};

component.situation = '0';
component.filecontents = '';

const setSituation = (gameInfo) => {
  // Possible situation: 0, 01, 012, 013, 0123, 02, 023, 03
  component.situation = '0';
  component.outcome = {
    play: '',
    0: '',
    1: '',
    2: '',
    3: ''
  };
  if (gameInfo.bases[1]) component.situation += '1';
  if (gameInfo.bases[2]) component.situation += '2';
  if (gameInfo.bases[3]) component.situation += '3';
};

const recordPlay = (gameInfo, play) => {
  component.outcome.play = play;
  component.filecontents += `${component.situation},`;
  component.filecontents += `${component.outcome.play},`;
  component.filecontents += `${component.outcome[0]},`;
  component.filecontents += `${component.outcome[1]},`;
  component.filecontents += `${component.outcome[2]},`;
  component.filecontents += `${component.outcome[3]}\n`;
};

const recordRunnerOutcome = (gameInfo, runnerInfo) => {
  component.outcome[runnerInfo.runner] = runnerInfo.result;
};

const appendFile = () => {
  return new Promise((resolve, reject) => {
    fs.appendFile(config.file, component.filecontents, function (err) {
       if (err) reject(err);
       resolve();
    });
  })
};

module.exports.initialize = function(params, imports, ready) {
  logger = imports['@brevetoxin/brevetoxin-winston'];
  logger.log('info', 'situation component initialized');
  eventBus = imports['eventBus'];
  config = params;
  eventBus.subscribe('newPlay', setSituation);
  eventBus.subscribe('play', recordPlay);
  eventBus.subscribe('runnerChange', recordRunnerOutcome);
  eventBus.subscribe('eof', appendFile);
  ready();
};

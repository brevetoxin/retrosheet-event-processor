var logger, config, eventBus;

const component = {};

component.situation = '0';

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
  console.log(component.situation);
  console.log(component.outcome);
};

const recordRunnerOutcome = (gameInfo, runnerInfo) => {
  component.outcome[runnerInfo.runner] = runnerInfo.result;
}

module.exports.initialize = function(params, imports, ready) {
  logger = imports['@brevetoxin/brevetoxin-winston'];
  logger.log('info', 'situation component initialized');
  eventBus = imports['eventBus'];
  config = params;
  eventBus.subscribe('newPlay', setSituation);
  eventBus.subscribe('play', recordPlay);
  eventBus.subscribe('runnerChange', recordRunnerOutcome);
  ready();
};

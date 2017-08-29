var logger, config, eventBus;

const component = {};

const testCallback = (gameInfo, eventData) => {
  console.log('Yay!');
  process.exit();
};

module.exports.initialize = function(params, imports, ready) {
  logger = imports['@brevetoxin/brevetoxin-winston'];
  logger.log('info', 'situation component initialized');
  eventBus = imports['eventBus'];
  config = params;
  eventBus.subscribe('test', testCallback);
  ready();
};

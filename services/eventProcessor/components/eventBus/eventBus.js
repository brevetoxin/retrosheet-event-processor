var logger, config;

const component = {};

component.events = {};

component.subscribe = (event, callback) => {
  component.events[event] = component.events[event] || [];
  component.events[event].push(callback);
};

component.trigger = (event, gameInfo, eventData) => {
  component.events[event].forEach(callback => {
    callback(gameInfo, eventData);
  });
};

module.exports.initialize = function(params, imports, ready) {
  logger = imports['@brevetoxin/brevetoxin-winston'];
  logger.log('info', 'eventBus component initialized');
  config = params;
  ready(component);
};

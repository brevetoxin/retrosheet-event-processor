var logger, config;

const component = {};

component.events = {};

component.subscribe = (event, callback) => {
  component.events[event] = component.events[event] || [];
  component.events[event].push(callback);
  console.log(component.events);
};

component.trigger = (event, gameInfo, eventData) => {
  console.log('here');
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

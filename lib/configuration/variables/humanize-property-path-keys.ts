export default (propertyPathKeys) => {
  const rootProperty = propertyPathKeys[0];
  if (propertyPathKeys.length === 1) return rootProperty;
  return `${rootProperty}.${propertyPathKeys.slice(1).join('.')}`;
};

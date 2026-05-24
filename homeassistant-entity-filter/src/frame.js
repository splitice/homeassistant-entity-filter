export function parseJsonMessageGroup(rawText) {
  const parsed = JSON.parse(rawText);
  return {
    messages: Array.isArray(parsed) ? parsed : [parsed],
    wasArray: Array.isArray(parsed),
  };
}

export function serializeJsonMessageGroup(messages, preferArray = false) {
  if (!messages.length) {
    return null;
  }
  if (messages.length === 1 && !preferArray) {
    return JSON.stringify(messages[0]);
  }
  return JSON.stringify(messages);
}

import { SERVICE_MODE, SERVICE_NAME } from './constants.js';

export function getHealthPayload() {
  return {
    status: 'ok',
    service: SERVICE_NAME,
    mode: SERVICE_MODE
  };
}

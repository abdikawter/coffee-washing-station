import axios from 'axios';
import { errorMessage } from '../api/client';

describe('api client helpers', () => {
  it('builds readable messages from the API error envelope', () => {
    const err = new axios.AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new axios.AxiosHeaders() },
      data: { statusCode: 400, error: 'VALIDATION_ERROR', code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ path: 'reason', message: 'Too small' }], requestId: 'r' },
    });
    expect(errorMessage(err)).toBe('Request validation failed — reason: Too small');
  });
  it('explains network failures', () => {
    expect(errorMessage(new axios.AxiosError('Network Error', 'ERR_NETWORK'))).toMatch(/Cannot reach the server/);
  });
});

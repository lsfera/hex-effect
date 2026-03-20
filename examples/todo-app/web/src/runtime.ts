import { Live } from '@projects/infra';
import { ManagedRuntime } from 'effect';

export const runtime = ManagedRuntime.make(Live);

process.on('sveltekit:shutdown', async () => {
  console.log('Disposing runtime...');
  await runtime.dispose();
  console.log('Done.');
});

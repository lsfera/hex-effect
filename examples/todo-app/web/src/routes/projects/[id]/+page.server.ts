import { Effect, Option } from 'effect';
import { ServiceLive } from '@projects/infra';
import { UseCases, Error as AppError } from '@projects/application';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = ({ params, platform }) =>
  platform!.runtime.runPromise(
    UseCases.getProjectWithTasks(params.id).pipe(
      Effect.provide(ServiceLive),
      AppError.mapErrors,
      Effect.map(
        Option.match({
          onNone: () => ({ project: null, tasks: [] }),
          onSome: ({ tasks, ...project }) => ({ project, tasks })
        })
      )
    )
  );

export const actions: Actions = {
  removeTask: async ({ request, platform }) => {
    const data = await request.formData();
    const taskId = data.get('taskId')?.toString();
    if (!taskId) return { success: false, error: 'Task ID is required' };
    return platform!.runtime.runPromise(
      UseCases.removeTask(taskId).pipe(
        Effect.provide(ServiceLive),
        AppError.mapErrors,
        Effect.match({
          onFailure: () => ({ success: false, error: 'Failed to remove task' }),
          onSuccess: () => ({ success: true })
        })
      )
    );
  },
  completeTask: async ({ request, platform }) => {
    const data = await request.formData();
    const taskId = data.get('taskId')?.toString();
    if (!taskId) return { success: false, error: 'Task ID is required' };
    return platform!.runtime.runPromise(
      UseCases.completeTask(taskId).pipe(
        Effect.provide(ServiceLive),
        AppError.mapErrors,
        Effect.match({
          onFailure: () => ({ success: false, error: 'Failed to complete task' }),
          onSuccess: () => ({ success: true })
        })
      )
    );
  },
  addTask: async ({ request, params, platform }) => {
    const data = await request.formData();
    const description = data.get('description')?.toString();
    if (!description) return { success: false, error: 'Description is required' };
    return platform!.runtime.runPromise(
      UseCases.addTaskToProject({ projectId: params.id, description }).pipe(
        Effect.provide(ServiceLive),
        AppError.mapErrors,
        Effect.match({
          onFailure: () => ({ success: false, error: 'Failed to add task' }),
          onSuccess: () => ({ success: true })
        })
      )
    );
  }
};

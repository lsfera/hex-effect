import { Project, Task } from '@projects/domain';
import { Effect, Option, Either } from 'effect';
import { DeleteTask, FindProjectById, GetAllProjects, GetTasksByProjectId, SaveProject, SaveTask } from './services.js';
import { IsolationLevel, withTXBoundary } from '@hex-effect/core';
import { ApplicationError, ErrorKinds } from './error.js';

export const createProject = (title: string) =>
  Project.Service.createProject(title).pipe(
    Effect.tap(([project]) => Effect.serviceFunctions(SaveProject).save(project)),
    Effect.map(([, event]) => [event]),
    withTXBoundary(IsolationLevel.Batched)
  );

export const addTaskToProject = (params: { projectId: string; description: string }) =>
  Effect.serviceFunctions(FindProjectById)
    .findById(Project.Model.ProjectId.make(params.projectId))
    .pipe(
      Effect.flatMap((opt) =>
        Either.fromOption(opt, () => new ApplicationError({ kind: ErrorKinds.NotFound }))
      ),
      Effect.andThen((project) => Task.Service.addTaskToProject(project, params.description)),
      Effect.tap(([task]) => Effect.serviceFunctions(SaveTask).save(task)),
      Effect.map(([, event]) => [event]),
      withTXBoundary(IsolationLevel.Batched)
    );

export const removeTask = (taskId: string) =>
  Task.Model.TaskRemovedEvent.make({ taskId: Task.Model.TaskId.make(taskId) }).pipe(
    Effect.tap(() => Effect.serviceFunctions(DeleteTask).delete(Task.Model.TaskId.make(taskId))),
    Effect.map((event) => [event]),
    withTXBoundary(IsolationLevel.Batched)
  );

export const getAllProjects = Effect.serviceFunctions(GetAllProjects).getAll();

export const getProjectWithTasks = (projectId: string) =>
  Effect.serviceFunctions(FindProjectById)
    .findById(Project.Model.ProjectId.make(projectId))
    .pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none()),
          onSome: (project) =>
            Effect.serviceFunctions(GetTasksByProjectId)
              .getByProjectId(project.id)
              .pipe(Effect.map((tasks) => Option.some({ ...project, tasks })))
        })
      )
    );

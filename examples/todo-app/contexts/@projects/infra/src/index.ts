import { UUIDGenerator } from '@hex-effect/core';
import {
  Live as InfraLive,
  NatsConfig,
  LibsqlConfig,
  LibsqlSdk
} from '@hex-effect/infra-libsql-nats';
import { Config, Effect, Layer } from 'effect';
import {
  DeleteTaskLive,
  FindProjectByIdLive,
  FindTaskByIdLive,
  GetAllProjectsLive,
  GetTasksByProjectIdLive,
  SaveProjectLive,
  SaveTaskLive,
  UpdateTaskLive
} from './service.js';
import { EventHandlersLive } from './event-handlers.js';
import { BadgesInfraLive } from '@badges/infra';
export { BadgesServiceLive, BadgesUseCases } from '@badges/infra';
import type { Services } from '@projects/application';

const ConfigLive = Layer.succeed(NatsConfig, {
  config: { servers: Config.string('NATS_SERVER') },
  appNamespace: Config.succeed('Kralf')
}).pipe(
  Layer.merge(Layer.succeed(LibsqlConfig, { config: { url: Config.string('DATABASE_URL') } }))
);

const MigrationsLive = Layer.unwrapEffect(
  LibsqlSdk.sdk.pipe(
    Effect.flatMap((sdk) =>
      Effect.promise(() =>
        sdk.migrate([
          {
            sql: `CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY NOT NULL,
              title TEXT NOT NULL
            );`,
            args: []
          },
          {
            sql: `CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              completed INTEGER NOT NULL,
              description TEXT NOT NULL,
              FOREIGN KEY (project_id) REFERENCES projects(id)
            );`,
            args: []
          },
          {
            sql: `DROP TABLE IF EXISTS tasks;`,
            args: []
          },
          {
            sql: `CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              completed INTEGER NOT NULL,
              description TEXT NOT NULL,
              FOREIGN KEY (project_id) REFERENCES projects(id)
            );`,
            args: []
          },
          {
            sql: `CREATE TABLE IF NOT EXISTS badges (
              id TEXT PRIMARY KEY NOT NULL,
              badge_type TEXT NOT NULL,
              awarded_at INTEGER NOT NULL
            );`,
            args: []
          }
        ])
      )
    ),
    Effect.as(Layer.empty)
  )
);

const BaseLive = InfraLive.pipe(
  Layer.provide(ConfigLive),
  Layer.provideMerge(UUIDGenerator.Default)
);

export const Live = Layer.mergeAll(MigrationsLive, EventHandlersLive, BadgesInfraLive).pipe(
  Layer.provideMerge(BaseLive)
);

export const ServiceLive = Layer.mergeAll(
  SaveProjectLive,
  GetAllProjectsLive,
  FindProjectByIdLive,
  SaveTaskLive,
  DeleteTaskLive,
  GetTasksByProjectIdLive,
  FindTaskByIdLive,
  UpdateTaskLive
) satisfies Layer.Layer<
  | Services.SaveProject
  | Services.GetAllProjects
  | Services.FindProjectById
  | Services.SaveTask
  | Services.DeleteTask
  | Services.GetTasksByProjectId
  | Services.FindTaskById
  | Services.UpdateTask,
  unknown,
  unknown
>;

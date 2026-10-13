import { defineRailway, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "sfo" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const worker = service("worker", {
    replicas: { "sfo": 1 },
  });
  const web = service("web", {
    replicas: { "sfo": 1 },
    // Railway only routes traffic to a new deploy once this returns 200 (503 = database unreachable),
    // so a broken release no longer replaces a working one
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
  });

  return project("open-eye", {
    variables: { managed: false },
    resources: [worker, web, Postgres, postgresVolume],
  });
});

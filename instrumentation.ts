import type { Instrumentation } from "next";
import { reportError } from "./lib/errors";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  await reportError(err, {
    source: context.routeType,
    route: request.path,
    method: request.method,
    extra: {
      routerKind: context.routerKind,
      routePath: context.routePath,
      renderSource: context.renderSource,
    },
  });
};

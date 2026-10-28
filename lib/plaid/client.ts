import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import type { PlaidConfig } from "@/lib/plaid/config";

export function plaidApi(config: PlaidConfig): PlaidApi {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.environment],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": config.clientId,
          "PLAID-SECRET": config.secret,
        },
      },
    }),
  );
}

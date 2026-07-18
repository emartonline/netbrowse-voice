import type { FastifyInstance } from "fastify";
import { requireOwner } from "./auth.js";
import { audit } from "./database.js";
import {
  payPalTopupLimits,
  paypalGatewayAdminSettings,
  savePayPalSandboxSettings,
  validPayPalClientId,
  validPayPalClientSecret,
} from "./paypal-settings.js";

interface PayPalSettingsBody {
  clientId?: unknown;
  clientSecret?: unknown;
  minimumTopup?: unknown;
  maximumTopup?: unknown;
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Administrative configuration for the wallet gateway.  It intentionally has
 * a separate owner-only route from customer checkout endpoints.
 */
export function registerPayPalSettingsRoutes(app: FastifyInstance): void {
  app.get("/api/billing/payments/paypal/settings", async (request, reply) => {
    const user = await requireOwner(request, reply);
    if (!user) return;
    return paypalGatewayAdminSettings();
  });

  app.patch<{ Body: PayPalSettingsBody }>(
    "/api/billing/payments/paypal/settings",
    async (request, reply) => {
      const user = await requireOwner(request, reply);
      if (!user) return;
      const clientId = optionalText(request.body?.clientId);
      const clientSecret = optionalText(request.body?.clientSecret);
      if (!validPayPalClientId(clientId)) {
        return reply.code(400).send({
          error: "Enter a valid PayPal Sandbox client ID",
        });
      }
      if (clientSecret && !validPayPalClientSecret(clientSecret)) {
        return reply.code(400).send({
          error: "Enter a valid PayPal Sandbox client secret",
        });
      }
      try {
        const existing = await paypalGatewayAdminSettings();
        if (!clientSecret && existing.source !== "gui") {
          return reply.code(400).send({
            error: "Enter the Sandbox client secret when moving payment settings into the GUI",
          });
        }
        const limits = payPalTopupLimits(
          request.body?.minimumTopup,
          request.body?.maximumTopup,
        );
        const saved = await savePayPalSandboxSettings({
          clientId,
          ...(clientSecret ? { clientSecret } : {}),
          ...limits,
          updatedBy: user.id,
        });
        await audit("paypal.sandbox.settings.updated", user.id, {
          configured: saved.configured,
          minimumTopup: saved.minimumTopup,
          maximumTopup: saved.maximumTopup,
        }, request.ip);
        return saved;
      } catch (error) {
        request.log.warn({ error }, "PayPal sandbox settings could not be saved");
        return reply.code(400).send({
          error: error instanceof Error
            ? error.message
            : "PayPal Sandbox settings could not be saved",
        });
      }
    },
  );
}

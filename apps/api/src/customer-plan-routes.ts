import type { FastifyInstance } from "fastify";
import { requireAdministrator } from "./auth.js";
import { customerServicePlanValues, type CustomerServicePlanValues } from "./customer-plans.js";
import { audit, pool } from "./database.js";
import { validUuid } from "./queue-agent-state.js";

interface IdParams { id: string }

export function registerCustomerPlanRoutes(app: FastifyInstance): void {
  app.post<{ Body: Partial<CustomerServicePlanValues> }>("/api/customer-plans", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    try {
      const values = customerServicePlanValues(request.body ?? {});
      const result = await pool.query<{ id: string }>(
        `INSERT INTO customer_service_plans
           (name, description, max_extensions, max_dids, recording_storage_mb,
            max_ai_receptionists, max_campaigns, self_service_extensions,
            recording_enabled, ai_receptionist_enabled, campaigns_enabled,
            enabled, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          values.name, values.description, values.maxExtensions, values.maxDids,
          values.recordingStorageMb, values.maxAiReceptionists, values.maxCampaigns,
          values.selfServiceExtensions, values.recordingEnabled,
          values.aiReceptionistEnabled, values.campaignsEnabled, values.enabled, user.id,
        ],
      );
      const id = result.rows[0]?.id;
      await audit("customer.plan.created", user.id, { servicePlanId: id }, request.ip);
      return reply.code(201).send({ id });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "A service plan with that name already exists" });
      }
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.patch<{ Params: IdParams; Body: Partial<CustomerServicePlanValues> }>(
    "/api/customer-plans/:id",
    async (request, reply) => {
      const user = await requireAdministrator(request, reply);
      if (!user) return;
      if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Service plan not found" });
      try {
        const values = customerServicePlanValues(request.body ?? {});
        const overLimit = await pool.query<{ customer_name: string; resource: string }>(
          `SELECT customers.name AS customer_name,
                  CASE
                    WHEN (SELECT count(*) FROM customer_extensions WHERE customer_id=customers.id) > $2 THEN 'extensions'
                    WHEN (SELECT count(*) FROM customer_did_routes WHERE customer_id=customers.id) > $3 THEN 'DIDs'
                    ELSE ''
                  END AS resource
             FROM customers
            WHERE customers.service_plan_id=$1
              AND (
                (SELECT count(*) FROM customer_extensions WHERE customer_id=customers.id) > $2
                OR (SELECT count(*) FROM customer_did_routes WHERE customer_id=customers.id) > $3
              )
            LIMIT 1`,
          [request.params.id, values.maxExtensions, values.maxDids],
        );
        const blocked = overLimit.rows[0];
        if (blocked) {
          return reply.code(409).send({
            error: `${blocked.customer_name} currently exceeds the proposed ${blocked.resource} limit`,
          });
        }
        const result = await pool.query(
          `UPDATE customer_service_plans
              SET name=$2, description=$3, max_extensions=$4, max_dids=$5,
                  recording_storage_mb=$6, max_ai_receptionists=$7,
                  max_campaigns=$8, self_service_extensions=$9,
                  recording_enabled=$10, ai_receptionist_enabled=$11,
                  campaigns_enabled=$12, enabled=$13, updated_at=now()
            WHERE id=$1`,
          [
            request.params.id, values.name, values.description, values.maxExtensions,
            values.maxDids, values.recordingStorageMb, values.maxAiReceptionists,
            values.maxCampaigns, values.selfServiceExtensions,
            values.recordingEnabled, values.aiReceptionistEnabled,
            values.campaignsEnabled, values.enabled,
          ],
        );
        if (result.rowCount !== 1) return reply.code(404).send({ error: "Service plan not found" });
        await audit("customer.plan.updated", user.id, { servicePlanId: request.params.id }, request.ip);
        return { ok: true };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "A service plan with that name already exists" });
        }
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.delete<{ Params: IdParams }>("/api/customer-plans/:id", async (request, reply) => {
    const user = await requireAdministrator(request, reply);
    if (!user) return;
    if (!validUuid(request.params.id)) return reply.code(404).send({ error: "Service plan not found" });
    const assigned = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM customers WHERE service_plan_id=$1",
      [request.params.id],
    );
    if (Number(assigned.rows[0]?.count ?? 0) > 0) {
      return reply.code(409).send({ error: "Move assigned customers to another plan before deleting this one" });
    }
    const result = await pool.query("DELETE FROM customer_service_plans WHERE id=$1", [request.params.id]);
    if (result.rowCount !== 1) return reply.code(404).send({ error: "Service plan not found" });
    await audit("customer.plan.deleted", user.id, { servicePlanId: request.params.id }, request.ip);
    return reply.code(204).send();
  });
}

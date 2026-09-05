import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { AUDIT_MODULE } from "../../modules/audit"

// Shared status-transition framework (BRD §10.5 "status changes use
// validated transitions", §5.5 audit requirements).
//
// Before this, every module hardcoded its own rule — the closest thing was
// the `ALLOWED` Set in api/admin/solar/quotes/[id]/status/route.ts, which is
// correct but checks only that the *target* is a known status, not that the
// move from the current one is legal. A pre-order cannot go from `delivered`
// back to `sourcing_confirmed`; an auction cannot go from `ended` to `draft`.
//
// The important property here is that a transition and its audit row are
// written together. Audit coverage becomes a property of the mechanism
// instead of something each route has to remember, which is what §5.5 needs
// to actually hold across three new features.

/** A state's legal next states, keyed by state. The set of states IS the set
 *  of keys — targets are constrained to keys via the self-referential bound
 *  on `defineStateMachine` below, so a typo in a target is a compile error
 *  rather than a runtime surprise. */
export type TransitionMap<S extends string> = {
  readonly [K in S]: readonly S[]
}

/** The states of a transition map, taken from its keys. */
export type StateOf<T> = Extract<keyof T, string>

export type Actor = {
  /** "user" for staff, "customer" for shoppers, "system" for jobs. */
  type: "user" | "customer" | "system"
  id?: string | null
  /** Denormalised label so the trail stays readable after the actor's
   *  record is removed. */
  label?: string | null
}

export const SYSTEM_ACTOR: Actor = { type: "system", label: "system" }

export type TransitionOptions = {
  /** Free-text justification. Pass `requireReason` on the machine to make
   *  this mandatory. */
  reason?: string | null
  /** Links this change to the wider customer journey (BRD §12.4). */
  correlationId?: string | null
  /** Extra before/after detail when a single from/to pair is too coarse. */
  changes?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

export type StateMachineConfig<S extends string> = {
  /** Stable slug for the audit trail: "preorder", "build_quote", "auction". */
  entityType: string
  transitions: TransitionMap<S>
  /** States from which no further transition is legal. Declared explicitly
   *  rather than inferred from an empty target list, so a genuinely
   *  terminal state reads differently from one whose edges aren't written
   *  yet. */
  terminal?: readonly S[]
  /** Transitions that must carry a reason, e.g. cancelling an auction after
   *  bidding has begun (§8.10). `true` demands one on every transition. */
  requireReason?: boolean | readonly S[]
}

export class StateMachine<S extends string> {
  constructor(private readonly config: StateMachineConfig<S>) {}

  get entityType(): string {
    return this.config.entityType
  }

  /** Every state the machine knows about. */
  states(): S[] {
    return Object.keys(this.config.transitions) as S[]
  }

  isKnown(state: string): state is S {
    return Object.prototype.hasOwnProperty.call(
      this.config.transitions,
      state
    )
  }

  isTerminal(state: S): boolean {
    return (this.config.terminal ?? []).includes(state)
  }

  /** States reachable from `from` in one step. */
  nextStates(from: S): readonly S[] {
    return this.config.transitions[from] ?? []
  }

  canTransition(from: S, to: S): boolean {
    return this.nextStates(from).includes(to)
  }

  private reasonRequiredFor(to: S): boolean {
    const rule = this.config.requireReason
    if (!rule) return false
    if (rule === true) return true
    return rule.includes(to)
  }

  /**
   * Validate a move without performing it. Throws a MedusaError the API
   * layer can surface directly.
   */
  assertTransition(from: string, to: string, reason?: string | null): void {
    if (!this.isKnown(to)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown ${this.config.entityType} status "${to}". Expected one of: ${this.states().join(", ")}`
      )
    }

    if (!this.isKnown(from)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${this.config.entityType} is in unknown status "${from}" and cannot be transitioned`
      )
    }

    if (from === to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${this.config.entityType} is already "${to}"`
      )
    }

    if (this.isTerminal(from)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `${this.config.entityType} is in terminal status "${from}" and cannot be changed`
      )
    }

    if (!this.canTransition(from, to)) {
      const allowed = this.nextStates(from)
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        allowed.length
          ? `Cannot move ${this.config.entityType} from "${from}" to "${to}". Allowed from here: ${allowed.join(", ")}`
          : `Cannot move ${this.config.entityType} out of "${from}"`
      )
    }

    if (this.reasonRequiredFor(to as S) && !reason?.trim()) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Moving ${this.config.entityType} to "${to}" requires a reason`
      )
    }
  }

  /**
   * Validate the move and write the audit row for it.
   *
   * Persisting the new status is the caller's job — it owns the module
   * service and often needs to write other fields in the same operation.
   * Call this first: if it throws, nothing should be written.
   *
   * Audit failures are logged, never thrown. A trail we could not write is
   * a serious operational problem, but failing the customer's transition
   * because of it would be worse.
   */
  async transition(
    container: MedusaContainer,
    args: {
      entityId: string
      from: string
      to: string
      actor?: Actor
    } & TransitionOptions
  ): Promise<void> {
    const { entityId, from, to, actor = SYSTEM_ACTOR } = args

    this.assertTransition(from, to, args.reason)

    await this.record(container, {
      entityId,
      action: "transition",
      fromValue: from,
      toValue: to,
      actor,
      reason: args.reason,
      correlationId: args.correlationId,
      changes: args.changes,
      metadata: args.metadata,
    })
  }

  /**
   * Write an audit row for something that is not a state change — a quote
   * revision, a voided bid, a materially edited listing.
   */
  async record(
    container: MedusaContainer,
    args: {
      entityId: string
      action: string
      fromValue?: string | null
      toValue?: string | null
      actor?: Actor
      reason?: string | null
      correlationId?: string | null
      changes?: Record<string, unknown> | null
      metadata?: Record<string, unknown> | null
    }
  ): Promise<void> {
    const { actor = SYSTEM_ACTOR } = args

    try {
      const audit: any = container.resolve(AUDIT_MODULE)
      await audit.createAuditEvents({
        entity_type: this.config.entityType,
        entity_id: args.entityId,
        action: args.action,
        from_value: args.fromValue ?? null,
        to_value: args.toValue ?? null,
        changes: args.changes ?? null,
        actor_type: actor.type,
        actor_id: actor.id ?? null,
        actor_label: actor.label ?? null,
        reason: args.reason?.trim() || null,
        correlation_id: args.correlationId ?? null,
        metadata: args.metadata ?? null,
      })
    } catch (err: any) {
      // Resolve the logger lazily — in a container without the audit module
      // registered we still want the warning to land somewhere.
      try {
        const logger: any = container.resolve("logger")
        logger.error(
          `[audit] failed to record ${this.config.entityType} ${args.action} on ${args.entityId}: ${err?.message ?? err}`
        )
      } catch {
        // Nothing else we can usefully do.
      }
    }
  }
}

/**
 * Build a state machine.
 *
 * The type parameter is inferred from the KEYS of `transitions`, and the
 * self-referential bound constrains every target to be one of those keys —
 * so `delivered: ["deliverd"]` fails to compile instead of silently creating
 * a state nothing can leave. Call sites pass their config `as const` to keep
 * the string literals narrow.
 */
export const defineStateMachine = <
  T extends { readonly [K in keyof T]: readonly Extract<keyof T, string>[] }
>(config: {
  entityType: string
  transitions: T
  terminal?: readonly StateOf<T>[]
  requireReason?: boolean | readonly StateOf<T>[]
}): StateMachine<StateOf<T>> =>
  new StateMachine(config as StateMachineConfig<StateOf<T>>)

/** Actor from an authenticated Medusa request, for API route call sites. */
export const actorFromRequest = (req: any): Actor => {
  const auth = req?.auth_context
  if (!auth?.actor_id) return SYSTEM_ACTOR
  return {
    type: auth.actor_type === "customer" ? "customer" : "user",
    id: auth.actor_id,
    label: auth.app_metadata?.email ?? auth.email ?? null,
  }
}

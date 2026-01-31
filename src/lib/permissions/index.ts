/**
 * Permission System
 * 
 * Implements Role-Based Access Control (RBAC) with the pattern:
 * resource:action:scope
 * 
 * - resource: What entity (manuscripts, journals, users)
 * - action: What operation (create, read, update, delete, manage)
 * - scope: What range (own, journal, publisher, all)
 */

// ============================================================
// Permission Building Blocks
// ============================================================

export enum Resource {
  MANUSCRIPTS = "manuscripts",
  JOURNALS = "journals",
  PUBLISHERS = "publishers",
  USERS = "users",
  REVIEWS = "reviews",
  SUBMISSIONS = "submissions",
  AUDIT_LOGS = "audit_logs",
  SETTINGS = "settings",
}

export enum Action {
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
  MANAGE = "manage", // Full control including permissions
  EXPORT = "export",
  SHARE = "share",
}

export enum Scope {
  OWN = "own", // Only resources they created/own
  JOURNAL = "journal", // Resources within their journal
  PUBLISHER = "publisher", // Resources within their publisher
  ALL = "all", // Global access (super admin)
}

// Permission string type
export type Permission = `${Resource}:${Action}` | `${Resource}:${Action}:${Scope}`;

// ============================================================
// Role Definitions
// ============================================================

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: Permission[];
  inherits?: string[]; // Roles to inherit from
}

export const ROLES: Record<string, RoleDefinition> = {
  // System-wide roles
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Full system access",
    permissions: [
      "*:*:all" as Permission, // Wildcard for all permissions
    ],
  },

  // Publisher-level roles
  PUBLISHER_OWNER: {
    name: "Publisher Owner",
    description: "Full control over publisher and all journals",
    permissions: [
      "publishers:manage:publisher",
      "journals:manage:publisher",
      "manuscripts:manage:publisher",
      "users:manage:publisher",
      "reviews:manage:publisher",
      "submissions:manage:publisher",
      "audit_logs:read:publisher",
      "settings:manage:publisher",
    ],
  },

  PUBLISHER_ADMIN: {
    name: "Publisher Admin",
    description: "Manage journals and users within publisher",
    permissions: [
      "publishers:read:publisher",
      "publishers:update:publisher",
      "journals:manage:publisher",
      "manuscripts:read:publisher",
      "users:manage:publisher",
      "reviews:read:publisher",
      "submissions:read:publisher",
      "audit_logs:read:publisher",
      "settings:read:publisher",
    ],
  },

  PUBLISHER_MEMBER: {
    name: "Publisher Member",
    description: "View access to publisher resources",
    permissions: [
      "publishers:read:publisher",
      "journals:read:publisher",
      "manuscripts:read:own",
      "users:read:publisher",
    ],
  },

  // Journal-level roles
  JOURNAL_ADMIN: {
    name: "Journal Admin",
    description: "Full control over journal",
    permissions: [
      "journals:manage:journal",
      "manuscripts:manage:journal",
      "users:manage:journal",
      "reviews:manage:journal",
      "submissions:manage:journal",
      "settings:manage:journal",
    ],
  },

  JOURNAL_EDITOR: {
    name: "Journal Editor",
    description: "Manage submissions and reviews",
    permissions: [
      "journals:read:journal",
      "manuscripts:read:journal",
      "manuscripts:update:journal",
      "reviews:manage:journal",
      "submissions:manage:journal",
      "users:read:journal",
    ],
  },

  JOURNAL_REVIEWER: {
    name: "Journal Reviewer",
    description: "Review assigned submissions",
    permissions: [
      "journals:read:journal",
      "manuscripts:read:own", // Only assigned manuscripts
      "reviews:create:own",
      "reviews:read:own",
      "reviews:update:own",
      "submissions:read:own",
    ],
  },

  // Default authenticated user
  USER: {
    name: "User",
    description: "Basic authenticated user",
    permissions: [
      "manuscripts:create:own",
      "manuscripts:read:own",
      "manuscripts:update:own",
      "manuscripts:delete:own",
      "manuscripts:share:own",
    ],
  },
};

// ============================================================
// Permission Checker
// ============================================================

export interface ScopeContext {
  ownerId?: string;
  journalId?: string;
  publisherId?: string;
}

export interface UserPermissionContext {
  userId: string;
  permissions: Permission[];
  publisherId?: string;
  journalId?: string;
}

export class PermissionChecker {
  constructor(private userContext: UserPermissionContext) {}

  /**
   * Check if user has permission for an action
   */
  can(resource: Resource, action: Action, targetScope?: ScopeContext): boolean {
    // Check for super admin wildcard
    if (this.hasPermission("*:*:all" as Permission)) {
      return true;
    }

    // Check for resource wildcard
    if (this.hasPermission(`${resource}:*:all` as Permission)) {
      return true;
    }

    // Check for action wildcard on resource
    if (this.hasPermission(`${resource}:manage` as Permission)) {
      return true;
    }

    // Get applicable scopes for this context
    const applicableScopes = this.getApplicableScopes(targetScope);

    // Check each scope from most specific to least
    for (const scope of applicableScopes) {
      const permission = `${resource}:${action}:${scope}` as Permission;
      if (this.hasPermission(permission)) {
        return this.validateScope(scope, targetScope);
      }

      // Check manage permission for scope
      const managePermission = `${resource}:manage:${scope}` as Permission;
      if (this.hasPermission(managePermission)) {
        return this.validateScope(scope, targetScope);
      }
    }

    // Check permission without scope (applies to own)
    const basePermission = `${resource}:${action}` as Permission;
    if (this.hasPermission(basePermission)) {
      return this.validateScope(Scope.OWN, targetScope);
    }

    return false;
  }

  /**
   * Throw error if permission check fails
   */
  authorize(resource: Resource, action: Action, targetScope?: ScopeContext): void {
    if (!this.can(resource, action, targetScope)) {
      throw new PermissionError(
        `You do not have permission to ${action} ${resource}`,
        resource,
        action
      );
    }
  }

  /**
   * Check if user has a specific permission string
   */
  private hasPermission(permission: Permission): boolean {
    return this.userContext.permissions.some((p) => {
      if (p === permission) return true;

      // Handle wildcards
      const [pResource, pAction, pScope] = p.split(":");
      const [rResource, rAction, rScope] = permission.split(":");

      return (
        (pResource === "*" || pResource === rResource) &&
        (pAction === "*" || pAction === "manage" || pAction === rAction) &&
        (pScope === "all" || pScope === rScope || !rScope)
      );
    });
  }

  /**
   * Validate that the user's scope covers the target
   */
  private validateScope(grantedScope: Scope, target?: ScopeContext): boolean {
    if (!target) return true;

    switch (grantedScope) {
      case Scope.ALL:
        return true;

      case Scope.PUBLISHER:
        return target.publisherId === this.userContext.publisherId;

      case Scope.JOURNAL:
        return (
          target.publisherId === this.userContext.publisherId &&
          target.journalId === this.userContext.journalId
        );

      case Scope.OWN:
        return target.ownerId === this.userContext.userId;

      default:
        return false;
    }
  }

  /**
   * Get applicable scopes from most restrictive to least
   */
  private getApplicableScopes(target?: ScopeContext): Scope[] {
    const scopes: Scope[] = [];

    if (target?.ownerId === this.userContext.userId) {
      scopes.push(Scope.OWN);
    }
    if (target?.journalId === this.userContext.journalId) {
      scopes.push(Scope.JOURNAL);
    }
    if (target?.publisherId === this.userContext.publisherId) {
      scopes.push(Scope.PUBLISHER);
    }
    scopes.push(Scope.ALL);

    return scopes;
  }
}

// ============================================================
// Permission Error
// ============================================================

export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly resource: Resource,
    public readonly action: Action
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get all permissions for a role, including inherited
 */
export function getRolePermissions(roleName: string): Permission[] {
  const role = ROLES[roleName];
  if (!role) return [];

  const permissions = new Set<Permission>(role.permissions);

  // Add inherited permissions
  if (role.inherits) {
    for (const inheritedRole of role.inherits) {
      const inheritedPermissions = getRolePermissions(inheritedRole);
      inheritedPermissions.forEach((p) => permissions.add(p));
    }
  }

  return Array.from(permissions);
}

/**
 * Check if a permission string is valid
 */
export function isValidPermission(permission: string): permission is Permission {
  const parts = permission.split(":");
  if (parts.length < 2 || parts.length > 3) return false;

  const [resource, action, scope] = parts;

  // Allow wildcards
  if (resource === "*" && action === "*") return true;

  const validResources = Object.values(Resource) as string[];
  const validActions = Object.values(Action) as string[];
  const validScopes = Object.values(Scope) as string[];

  if (!validResources.includes(resource) && resource !== "*") return false;
  if (!validActions.includes(action) && action !== "*") return false;
  if (scope && !validScopes.includes(scope) && scope !== "all") return false;

  return true;
}

/**
 * Create a permission checker from session
 */
export function createPermissionChecker(
  userId: string,
  roles: string[],
  publisherId?: string,
  journalId?: string
): PermissionChecker {
  // Collect all permissions from roles
  const permissions = new Set<Permission>();
  for (const role of roles) {
    getRolePermissions(role).forEach((p) => permissions.add(p));
  }

  return new PermissionChecker({
    userId,
    permissions: Array.from(permissions),
    publisherId,
    journalId,
  });
}

export function definePermissions(config) {
    function createChecker(role) {
        const rolePerms = config.roles[role];
        const grantedSet = new Set(rolePerms);
        return {
            has: (p) => grantedSet.has(p),
            require: (p) => {
                if (!grantedSet.has(p)) {
                    throw new Response("Forbidden", { status: 403 });
                }
            },
            granted: [...rolePerms],
        };
    }
    return {
        createChecker,
        permissions: config.permissions,
        roles: config.roles,
    };
}

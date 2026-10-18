export type Crumb = {
  label: string;
  href?: string;
};

export type PageMeta = {
  title: string;
  crumbs: Crumb[];
};

export type NavItem = {
  label: string;
  href: string;
  description: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Inventory",
    items: [
      { label: "Items", href: "/items", description: "Inventory items" },
      {
        label: "Taxonomies & fields",
        href: "/taxonomies",
        description: "Taxonomies, fields, and value lists",
      },
      { label: "Labels", href: "/labels", description: "Print item labels" },
    ],
  },
  {
    label: "Sales",
    items: [
      {
        label: "Sales orders",
        href: "/sales/orders",
        description: "Create and track customer orders.",
      },
    ],
  },
  {
    label: "Purchasing",
    items: [
      {
        label: "Purchase orders",
        href: "/purchasing/orders",
        description: "Order stock from suppliers.",
      },
    ],
  },
  {
    label: "Warehouse",
    items: [
      {
        label: "Pick/pack/ship",
        href: "/warehouse/pick",
        description: "Pick, pack, and ship sales orders.",
      },
      {
        label: "Receiving",
        href: "/warehouse/receiving",
        description: "Receive purchase orders into inventory.",
      },
    ],
  },
  {
    label: "Pricing",
    items: [
      {
        label: "Pricing office",
        href: "/pricing",
        description: "Set and review selling prices.",
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        label: "Users",
        href: "/admin/users",
        description: "Manage who can sign in and what they can do.",
      },
    ],
  },
];

export function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function pageMetaFor(pathname: string): PageMeta {
  if (pathname === "/items/new") {
    return {
      title: "New item",
      crumbs: [
        { label: "Inventory" },
        { label: "Items", href: "/items" },
        { label: "New item" },
      ],
    };
  }

  const photo = pathname.match(/^\/items\/([^/]+)\/photos\/[^/]+$/);
  if (photo) {
    return {
      title: "Edit photo",
      crumbs: [
        { label: "Inventory" },
        { label: "Items", href: "/items" },
        { label: "Item", href: `/items/${photo[1]}` },
        { label: "Edit photo" },
      ],
    };
  }

  if (/^\/items\/[^/]+$/.test(pathname)) {
    return {
      title: "Edit item",
      crumbs: [
        { label: "Inventory" },
        { label: "Items", href: "/items" },
        { label: "Edit item" },
      ],
    };
  }

  const fields = pathname.match(/^\/taxonomies\/([^/]+)$/);
  if (fields) {
    return {
      title: "Fields",
      crumbs: [
        { label: "Inventory" },
        { label: "Taxonomies & fields", href: "/taxonomies" },
        { label: "Fields" },
      ],
    };
  }

  for (const group of NAV_GROUPS) {
    const item = group.items.find((entry) => entry.href === pathname);
    if (item) {
      return {
        title: item.label,
        crumbs: [{ label: group.label }, { label: item.label }],
      };
    }
  }

  return {
    title: "ITS",
    crumbs: [{ label: "ITS" }],
  };
}

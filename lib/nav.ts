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
  children?: NavItem[];
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
      { label: "Lens", href: "/lens", description: "Identify an item from photos." },
      {
        label: "Taxonomies & Fields",
        href: "/taxonomies",
        description: "Taxonomies, fields, and value lists",
      },
      { label: "Labels", href: "/labels", description: "Print item labels" },
    ],
  },
  {
    label: "Contacts",
    items: [
      { label: "Customers", href: "/customers", description: "Customers synced with QuickBooks." },
      { label: "Vendors", href: "/vendors", description: "Vendors synced with QuickBooks." },
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
        description: "Create and send purchase orders.",
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
      {
        label: "Scan",
        href: "/scan",
        description: "Scan an item QR code, a SKU barcode, or a bin code.",
      },
      {
        label: "Bin labels",
        href: "/warehouse/bins",
        description: "Print pallet, crate, and box labels.",
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
        label: "Manufacturers",
        href: "/admin/manufacturers",
        description: "Manufacturer names and aliases.",
      },
      {
        label: "Users",
        href: "/admin/users",
        description: "Manage who can sign in and what they can do.",
      },
      {
        label: "Settings",
        href: "/admin/settings",
        description: "Pricing window, labels, bin numbers, and other app settings.",
      },
      {
        label: "Integrations",
        href: "/admin/integrations",
        description: "QuickBooks, eBay, and other connections.",
        children: [
          {
            label: "QuickBooks",
            href: "/admin/integrations/quickbooks",
            description: "Sync customers and vendors.",
          },
          {
            label: "eBay",
            href: "/admin/integrations/ebay",
            description: "Seller connection for listings later.",
          },
        ],
      },
    ],
  },
];

export function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function pageMetaFor(pathname: string): PageMeta {
  if (pathname === "/export-setup") {
    return {
      title: "Export setup",
      crumbs: [
        { label: "Inventory" },
        { label: "Items", href: "/items" },
        { label: "Export setup" },
      ],
    };
  }

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

  const bin = pathname.match(/^\/warehouse\/bins\/([^/]+)$/);
  if (bin) {
    return {
      title: decodeURIComponent(bin[1]),
      crumbs: [
        { label: "Warehouse" },
        { label: "Scan", href: "/scan" },
        { label: decodeURIComponent(bin[1]) },
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

  if (pathname === "/customers/new") {
    return {
      title: "New customer",
      crumbs: [
        { label: "Contacts" },
        { label: "Customers", href: "/customers" },
        { label: "New customer" },
      ],
    };
  }

  if (/^\/customers\/[^/]+$/.test(pathname)) {
    return {
      title: "Edit customer",
      crumbs: [
        { label: "Contacts" },
        { label: "Customers", href: "/customers" },
        { label: "Edit customer" },
      ],
    };
  }

  if (pathname === "/purchasing/orders/new") {
    return {
      title: "New purchase order",
      crumbs: [
        { label: "Purchasing" },
        { label: "Purchase orders", href: "/purchasing/orders" },
        { label: "New purchase order" },
      ],
    };
  }

  if (/^\/purchasing\/orders\/[^/]+$/.test(pathname)) {
    return {
      title: "Purchase order",
      crumbs: [
        { label: "Purchasing" },
        { label: "Purchase orders", href: "/purchasing/orders" },
        { label: "Purchase order" },
      ],
    };
  }

  if (pathname === "/vendors/new") {
    return {
      title: "New vendor",
      crumbs: [
        { label: "Contacts" },
        { label: "Vendors", href: "/vendors" },
        { label: "New vendor" },
      ],
    };
  }

  if (/^\/vendors\/[^/]+$/.test(pathname)) {
    return {
      title: "Edit vendor",
      crumbs: [
        { label: "Contacts" },
        { label: "Vendors", href: "/vendors" },
        { label: "Edit vendor" },
      ],
    };
  }

  const fields = pathname.match(/^\/taxonomies\/([^/]+)$/);
  if (fields) {
    return {
      title: "Fields",
      crumbs: [
        { label: "Inventory" },
        { label: "Taxonomies & Fields", href: "/taxonomies" },
        { label: "Fields" },
      ],
    };
  }

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const child = item.children?.find((entry) => entry.href === pathname);
      if (child) {
        return {
          title: child.label,
          crumbs: [
            { label: group.label },
            { label: item.label, href: item.href },
            { label: child.label },
          ],
        };
      }
      if (item.href === pathname) {
        return {
          title: item.label,
          crumbs: [{ label: group.label }, { label: item.label }],
        };
      }
    }
  }

  return {
    title: "ITS",
    crumbs: [{ label: "ITS" }],
  };
}

import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy — ITS",
  description: "Privacy policy for the ITS internal inventory application.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy">
      <h2>Who operates ITS</h2>
      <p>
        ITS is an internal inventory and operations application. Deep Discount Servers, a server
        and IT hardware reseller, operates it for its own employees. It is not a product sold to
        the public.
      </p>
      <p>
        Email <a href="mailto:jan@deepdiscountservers.com">jan@deepdiscountservers.com</a>.
        Mailing address: 3730 E Dale Ave, Henderson, Nevada 89044
      </p>

      <h2>What the app is for</h2>
      <p>
        Employees use ITS to track inventory and to handle the customer and vendor records that
        go with that work. People outside the company are not expected to have an account.
      </p>

      <h2>Information the app handles</h2>
      <p>
        ITS stores inventory records and the customer and vendor details needed to match the
        company&apos;s books. That can include a display name, company name, given and family
        name, email address, phone number, billing and shipping address, a tax identifier where
        the books use one, notes, and whether the record is active.
      </p>
      <p>
        ITS also stores the connection to the company&apos;s own QuickBooks Online company. That
        connection includes OAuth tokens. Those tokens are stored only on the server. They are
        not placed in a public setting, and the browser is not given a way to read them.
      </p>

      <h2>QuickBooks Online</h2>
      <p>
        ITS connects only to the company&apos;s own QuickBooks Online account. The connection
        uses Intuit OAuth 2.0 with the accounting scope only
        (<code>com.intuit.quickbooks.accounting</code>). ITS uses that connection to read and
        update customers and vendors.
      </p>
      <p>
        An authorized employee can disconnect at any time in the app, under Admin, then
        Integrations, with Disconnect. Disconnect revokes the token with Intuit and deletes the
        copy ITS stored. The connection can also be revoked from the Intuit account.
      </p>

      <h2>Where data is stored</h2>
      <p>
        Business data is stored in the company&apos;s Supabase database (Postgres), hosted in the
        United States. The application host runs the ITS server. QuickBooks data that stays in
        QuickBooks remains with Intuit under Intuit&apos;s terms.
      </p>

      <h2>Sharing</h2>
      <p>
        Deep Discount Servers does not sell this data and does not share it with third parties
        for their own marketing or resale. Data is processed by the service providers that run
        the tool: Intuit (QuickBooks Online), Supabase (the database), and the hosting provider
        that runs the application. They handle it so ITS can function.
      </p>

      <h2>Who can use it</h2>
      <p>
        Access is limited to authorized employees. Customers, vendors, and the general public
        are not users of ITS.
      </p>

      <h2>How long data is kept</h2>
      <p>
        Records are kept while the company needs them for its business. That includes the time a
        customer, vendor, or employment relationship is active and any longer period the books
        must be retained. Email jan@deepdiscountservers.com to ask for deletion of personal
        information the company is not required to keep. Records that live in QuickBooks stay
        there until someone changes them in QuickBooks.
      </p>

      <h2>Security</h2>
      <p>
        The company limits the app to authorized employees, stores QuickBooks tokens only on the
        server, and relies on the access controls of Supabase and the host. Disconnect revokes
        the Intuit token. No method of storage or transmission is perfectly secure.
      </p>

      <h2>Children</h2>
      <p>
        ITS is not for children. Deep Discount Servers does not knowingly collect information
        from children, and children are not authorized to use the app.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, this page will show a new &quot;Last updated&quot; date. The
        company applies the updated policy to this internal tool from that date.
      </p>
    </LegalDocument>
  );
}

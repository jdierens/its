import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Terms of Use — ITS",
  description: "Terms of use for the ITS internal inventory application.",
};

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Use">
      <p>
        These terms are the end user license for ITS. They apply to people who are allowed to
        use the app.
      </p>

      <h2>License</h2>
      <p>
        Deep Discount Servers lets authorized employees use ITS for the company&apos;s own
        inventory and operations work. The license is limited, non-exclusive, and
        non-transferable. It ends when your authorization ends. You do not own the software,
        and you may not give it, or a copy of it, to anyone else.
      </p>

      <h2>Who may use ITS</h2>
      <p>
        Only authorized employees of Deep Discount Servers may use ITS. If the company has not
        authorized you, you may not use the app.
      </p>

      <h2>Acceptable use</h2>
      <p>Use ITS only for the company&apos;s work. You may not:</p>
      <ul>
        <li>bypass or probe access controls</li>
        <li>connect a QuickBooks company that is not the company&apos;s own account</li>
        <li>copy data out of ITS for a purpose the company did not authorize</li>
        <li>interfere with the app or the QuickBooks connection</li>
      </ul>

      <h2>QuickBooks data</h2>
      <p>
        Customer and vendor records, including records read from or written to QuickBooks
        Online, remain the property of Deep Discount Servers. ITS reaches QuickBooks only
        through Intuit OAuth 2.0, and only with the accounting scope, for that one company
        account.
      </p>
      <p>
        Intuit is not responsible for ITS. Intuit does not provide, operate, or support this
        application. A problem in ITS is not a claim against Intuit.
      </p>

      <h2>No warranty</h2>
      <p>
        ITS is provided as is and as available, for internal use. Deep Discount Servers does
        not warrant that the app will be uninterrupted, error-free, or fit for a particular
        purpose. Inventory figures and QuickBooks sync results should be checked before you
        rely on them.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, Deep Discount Servers is not liable for indirect,
        incidental, special, or consequential damages, or for lost profits, lost data, or
        business interruption, arising out of the use of ITS. ITS is an internal tool and not
        a paid product offered to you. The company&apos;s liability for a claim about the app
        will not exceed the fees you paid to use it, which are none.
      </p>

      <h2>Termination</h2>
      <p>
        The company can end or suspend access at any time, including when someone leaves or
        misuses the app. When access ends, the license ends. Disconnecting QuickBooks in the
        app revokes that connection. It does not, by itself, delete the company&apos;s
        inventory records.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Nevada, except where those rules
        would apply another place&apos;s law. These terms do not choose a court or venue.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href="mailto:jan@deepdiscountservers.com">jan@deepdiscountservers.com</a>. Mailing
        address: 3730 E Dale Ave, Henderson, Nevada 89044
      </p>
    </LegalDocument>
  );
}

import Link from "next/link";
import { DocumentBarcode } from "@/components/DocumentBarcode";
import { LetterPrint } from "@/components/LetterPrint";
import { PrintDocumentButton } from "@/components/PrintDocumentButton";
import { CUSTOMER_DOCUMENT_COMPANY, CUSTOMER_DOCUMENT_LOGO } from "@/lib/customerDocument";
import { CUSTOMER_DOCUMENT_PRINT } from "@/lib/letterPrint";
import type { PurchaseOrderDocument } from "@/lib/purchaseOrderDocument";

export function PurchaseOrderDocument({ document, orderId }: { document: PurchaseOrderDocument; orderId: string }) {
  const company = CUSTOMER_DOCUMENT_COMPANY;
  return (
    <main className="cust-doc-page ds">
      <LetterPrint
        orientation={CUSTOMER_DOCUMENT_PRINT.orientation}
        rootSelector={CUSTOMER_DOCUMENT_PRINT.rootSelector}
        fragmentSelector={CUSTOMER_DOCUMENT_PRINT.fragmentSelector}
      />
      <div className="cust-doc-tools no-print">
        <Link href={`/purchasing/orders/${orderId}`}>Back to purchase order</Link>
        <PrintDocumentButton />
      </div>
      <article className="cust-doc">
        <header className="cust-doc-top">
          <img className="cust-doc-logo" src={CUSTOMER_DOCUMENT_LOGO} alt="" />
          <div className="cust-doc-company">
            <p className="cust-doc-company-name">{company.name}</p>
            <p className="cust-doc-company-address">{company.address}</p>
          </div>
          <h1 className="cust-doc-title">{document.title}</h1>
        </header>
        <div className="cust-doc-bank-row">
          <div>
            <p className="cust-doc-bank-title">{company.bankTitle}</p>
            <div className="cust-doc-bank">
              <div>
                {company.bankLeft.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <div>
                {company.bankRight.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          </div>
          <DocumentBarcode value={document.barcode} />
        </div>
        <div className="cust-doc-ref">
          <span>REF</span>
          <strong>{document.number}</strong>
          <span className="cust-doc-ref-date">DATE {document.documentDate}</span>
        </div>
        <section className="cust-doc-parties">
          <div className="cust-doc-party-labels">
            <span>Vendor</span>
          </div>
          <div className="cust-doc-party-grid">
            <div className="cust-doc-label">VENDOR</div>
            <address>
              {document.vendorLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
            <div className="cust-doc-label">SHIP TO</div>
            <address>
              {document.shipToLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
          </div>
          {document.tracking ? (
            <div className="cust-doc-party-grid cust-doc-refs">
              <div className="cust-doc-label">TRACKING</div>
              <div>{document.tracking}</div>
            </div>
          ) : null}
          <div className="cust-doc-terms po-doc-terms">
            <div>
              <span>ORD DATE</span>
              <strong>{document.orderDate}</strong>
            </div>
            <div>
              <span>EXPECTED</span>
              <strong>{document.expectedOn}</strong>
            </div>
            <div>
              <span>PAYMENT TERM</span>
              <strong>{document.terms}</strong>
            </div>
            <div>
              <span>FULFILLMENT</span>
              <strong>{document.fulfillment}</strong>
            </div>
          </div>
        </section>
        <table className="cust-doc-lines">
          <thead>
            <tr>
              <th className="sku">SKU</th>
              <th>Description</th>
              <th className="num">
                Quantity
                <br />
                Ordered
              </th>
              <th className="num">Unit Price</th>
              <th className="num">Ext Price</th>
            </tr>
          </thead>
          <tbody>
            {document.lines.map((line, index) => (
              <tr key={`${line.sku}-${index}`}>
                <td className="sku cust-doc-sku">{line.sku}</td>
                <td>
                  <div>{line.description}</div>
                  {line.extra.map((extra) => (
                    <div key={extra}>{extra}</div>
                  ))}
                </td>
                <td className="num">{line.qty}</td>
                <td className="num">{line.unitPrice}</td>
                <td className="num">{line.extPrice}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="cust-doc-foot">
          <div className="cust-doc-notes">
            <p>NOTES</p>
            {document.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
          <dl>
            <div>
              <dt>SUBTOTAL</dt>
              <dd>{document.subtotal}</dd>
            </div>
            <div>
              <dt>FREIGHT</dt>
              <dd>{document.freight}</dd>
            </div>
            <div className="cust-doc-total">
              <dt>TOTAL</dt>
              <dd>{document.total}</dd>
            </div>
          </dl>
        </footer>
      </article>
    </main>
  );
}

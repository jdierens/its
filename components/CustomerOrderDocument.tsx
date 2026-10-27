import Link from "next/link";
import { DocumentBarcode } from "@/components/DocumentBarcode";
import { PrintDocumentButton } from "@/components/PrintDocumentButton";
import { CUSTOMER_DOCUMENT_COMPANY, CUSTOMER_DOCUMENT_LOGO, type CustomerDocument } from "@/lib/customerDocument";

export function CustomerOrderDocument({ document, orderId }: { document: CustomerDocument; orderId: string }) {
  const company = CUSTOMER_DOCUMENT_COMPANY;
  return (
    <main className="cust-doc-page">
      <div className="cust-doc-tools no-print">
        <Link href={`/sales/orders/${orderId}`}>Back to sales order</Link>
        <PrintDocumentButton />
      </div>
      <article className="cust-doc">
        <header className="cust-doc-top">
          <img className="cust-doc-logo" src={CUSTOMER_DOCUMENT_LOGO} alt="" />
          <div className="cust-doc-company">
            <p className="cust-doc-company-name">{company.name}</p>
            <p>{company.address}</p>
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
          <strong>{document.salesOrderRef}</strong>
          <span>Col36</span>
          <span className="cust-doc-ref-date">{document.documentDate}</span>
        </div>
        <section className="cust-doc-parties">
          <div className="cust-doc-party-labels">
            <span>Customer</span>
            <span>Ship Address</span>
          </div>
          <div className="cust-doc-party-grid">
            <div className="cust-doc-label">BILL TO</div>
            <address>
              {document.billTo.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
            <div className="cust-doc-label">SHIP TO</div>
            <address>
              {document.shipTo.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
          </div>
          <div className="cust-doc-party-grid cust-doc-refs">
            <div className="cust-doc-label">YOUR ORDER REF</div>
            <div>{document.orderRef}</div>
            <div className="cust-doc-label">TRACKING</div>
            <div>{document.tracking}</div>
          </div>
          <div className="cust-doc-terms">
            <div>
              <span>ORD DATE</span>
              <strong>{document.orderDate}</strong>
            </div>
            <div>
              <span>SALES REP</span>
              <strong>{document.salesRep}</strong>
            </div>
            <div>
              <span>PAYMENT TERM</span>
              <strong>{document.paymentTerms}</strong>
            </div>
            <div>
              <span>INCOTERMS</span>
              <strong>{document.incoterms}</strong>
            </div>
            <div>
              <span>SHIPPING METHOD</span>
              <strong>{document.shipMethod}</strong>
            </div>
            <div>
              <span>SHIPPING ACCOUNT</span>
              <strong>{document.shipAccount}</strong>
            </div>
          </div>
        </section>
        <div className="cust-doc-colkeys" aria-hidden="true">
          <span>Col26</span>
          <span>Col48</span>
          <span>Col27</span>
          <span>Col44</span>
          <span>Col29</span>
        </div>
        <table className="cust-doc-lines">
          <thead>
            <tr>
              <th>
                DDS
                <br />
                SKU
              </th>
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
                <td className="cust-doc-sku">{line.sku}</td>
                <td>
                  <div>{line.description}</div>
                  {line.extra.map((extra) => (
                    <div key={extra}>{extra}</div>
                  ))}
                  {line.compliance ? <div className="cust-doc-meta">{line.compliance}</div> : null}
                  {line.serials.length > 0 ? (
                    <div className="cust-doc-serials">
                      <div>SERIAL NUMBERS</div>
                      {line.serials.map((row) => (
                        <div key={row}>{row}</div>
                      ))}
                    </div>
                  ) : null}
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
              <dt>TAX</dt>
              <dd>{document.tax}</dd>
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

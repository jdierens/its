declare module "qrcode" {
  export type QRCodeErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  export interface QRCodeModules {
    size: number;
    get(row: number, col: number): number | boolean;
  }

  export interface QRCodeSymbol {
    version: number;
    modules: QRCodeModules;
  }

  export interface QRCodeOptions {
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
    version?: number;
  }

  export function create(text: string, options?: QRCodeOptions): QRCodeSymbol;

  const QRCode: {
    create: typeof create;
  };

  export default QRCode;
}

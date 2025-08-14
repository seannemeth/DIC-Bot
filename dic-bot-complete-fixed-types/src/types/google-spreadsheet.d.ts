declare module 'google-spreadsheet' {
  export class GoogleSpreadsheet {
    constructor(id: string);
    useServiceAccountAuth(creds: { client_email: string; private_key: string }): Promise<void>;
    loadInfo(): Promise<void>;
    sheetsByTitle: Record<string, GoogleSpreadsheetWorksheet>;
  }
  export class GoogleSpreadsheetWorksheet {
    loadHeaderRow(): Promise<void>;
    getRows(): Promise<Array<{ get: (k: string) => any }>>;
  }
}

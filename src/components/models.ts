// Interfaces
export interface SmartCard {
  name?: string | undefined;
  iccid?: string | undefined;
  id?: string | undefined;
}

export interface Reader {
  name: string
  status: string
  iccid: string
  card_number: string
  online?: boolean | undefined
  authentication?: boolean | undefined
}

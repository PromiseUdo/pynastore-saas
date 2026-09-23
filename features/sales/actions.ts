// features/sales/actions.ts
// Barrel re-export — single stable import path, mirrors features/procurement/actions.ts
// and features/inventory/actions.ts. No 'use server' directive here: each
// source file already carries its own.

export { listCustomers, createCustomer, updateCustomer, type CustomerRow } from './customers';

export {
  createQuote,
  listQuotes,
  getQuote,
  sendQuote,
  acceptQuote,
  rejectQuote,
  convertQuoteToInvoice,
  type QuoteListRow,
  type QuoteLineItemRow,
  type QuoteDetail,
} from './quotes';

export {
  createInvoice,
  listInvoices,
  getInvoice,
  issueInvoice,
  sendInvoice,
  sendInvoiceReminder,
  recordPayment,
  voidInvoice,
  type InvoiceListRow,
  type InvoiceLineItemRow,
  type InvoiceDetail,
  type PaymentRow,
} from './invoices';

export {
  requestReturn,
  listReturns,
  getReturn,
  approveReturn,
  rejectReturn,
  type ReturnListRow,
  type ReturnLineItemRow,
  type ReturnDetail,
} from './returns';

export {
  listFulfillments,
  getFulfillment,
  recordPicked,
  recordPacked,
  markShipped,
  cancelFulfillment,
  type FulfillmentListRow,
  type FulfillmentLineItemRow,
  type FulfillmentDetail,
} from './fulfillment';

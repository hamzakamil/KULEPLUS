-- Down migration for trade documents
DROP TABLE IF EXISTS document_links;
DROP TABLE IF EXISTS delivery_lines;
DROP TABLE IF EXISTS deliveries;
DROP TABLE IF EXISTS purchase_order_lines;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS sales_order_lines;
DROP TABLE IF EXISTS sales_orders;
DROP TABLE IF EXISTS sales_quote_lines;
DROP TABLE IF EXISTS sales_quotes;
DROP TABLE IF EXISTS document_number_sequences;
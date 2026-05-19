-- Truncate orders and order_items for testing purposes
-- WARNING: This is a DESTRUCTIVE operation. Only run in development/test environments.

-- Truncate order_items first (child table)
TRUNCATE TABLE order_items CASCADE;

-- Truncate orders (parent table) - CASCADE above handles this, but being explicit
TRUNCATE TABLE orders CASCADE;

-- Reset sequences if any
ALTER SEQUENCE IF EXISTS orders_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS order_items_id_seq RESTART WITH 1;

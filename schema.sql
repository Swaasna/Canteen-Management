-- Run automatically by server.js on startup. Kept here for reference / viva.
CREATE TABLE IF NOT EXISTS menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'Snacks',
  price DECIMAL(8,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  is_special TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token_no INT NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status ENUM('Preparing','Ready','Collected') NOT NULL DEFAULT 'Preparing',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  menu_item_id INT NULL,
  item_name VARCHAR(100) NOT NULL,
  qty INT NOT NULL,
  unit_price DECIMAL(8,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
);

// Ilk giriste (veya admin sifre sifirladiginda) sifre degisikligini zorunlu kilar.
exports.up = function (knex) {
  return knex.schema.alterTable('users', (table) => {
    table.boolean('must_change_password').notNullable().defaultTo(false).after('password_hash');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('users', (table) => {
    table.dropColumn('must_change_password');
  });
};

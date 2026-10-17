// Verilen islemi en fazla `ms` milisaniye bekler; sure dolarsa hata ile reddeder.
// Islem senkron hata firlatsa bile reddedilmis promise'e cevrilir.
function withTimeout(operation, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} ${ms} ms icinde yanit vermedi`)), ms);
  });
  const work = Promise.resolve().then(typeof operation === 'function' ? operation : () => operation);

  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };

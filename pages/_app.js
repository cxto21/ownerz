import '../styles/globals.css'
import Head from 'next/head'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link rel="icon" href="/images/favicon.ico" sizes="any" />
        <title>Ownerz — Private Data Vault</title>
      </Head>
      <Component {...pageProps} />
    </>
  )
}

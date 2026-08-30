import '../styles/globals.css'
import Head from 'next/head'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/images/favicon.ico" sizes="any" />
        <title>Ownerz — Private Data Vault</title>
      </Head>
      <Component {...pageProps} />
    </>
  )
}

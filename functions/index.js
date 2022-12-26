'use strict'
const functions = require('firebase-functions')
const admin = require('firebase-admin')
const storage = require('@google-cloud/storage')
const { TextractClient, AnalyzeExpenseCommand } = require('@aws-sdk/client-textract')

admin.initializeApp()

const ACCESS_KEY_ID = functions.config().app.access_key_id
const SECRET_ACCESS_KEY = functions.config().app.secret_access_key
const REGION = functions.config().app.region

const credentials = {
  accessKeyId: ACCESS_KEY_ID,
  secretAccessKey: SECRET_ACCESS_KEY
}

exports.processInvoices = functions.https.onCall(async (data, context) => {
  // Get a reference to the Firestore collection
  const storageClient = new storage.Storage()
  const bucket = storageClient.bucket('invoice-parser-c1c7c.appspot.com')

  // Query the collection for documents with a status of "Processing"
  const docs = await admin
    .firestore()
    .collection('invoices')
    .where('status', '==', 'Processing')
    .get()
    .then((snapshot) => {
      // Create an array to store the retrieved documents
      const documents = []

      // Iterate through the snapshot and add each document to the array
      snapshot.forEach((doc) => {
        documents.push({ id: doc.id, ...doc.data() })
      })

      // Return the array of documents
      return documents
    })
    .catch((error) => {
      throw new functions.https.HttpsError('Error retrieving documents', error)
    })

  const textractClient = new TextractClient({ credentials, region: REGION })

  for (const doc of docs) {
    try {
      const file = bucket.file(doc.filePath)
      const [data] = await file.download()

      const params = {
        Document: {
          Bytes: data
        }
      }

      const command = new AnalyzeExpenseCommand(params)
      const response = await textractClient.send(command)

      var total,
        abn,
        invoiceValue,
        invoiceDate = null
      // iterate over the ExpenseDocuments and extract the data
      for (const expenseDocument of response.ExpenseDocuments) {
        // currently the keys used here are hacky, because the way the pdf(s) differ from each other
        // to solve this problem, client must have a way to set what key(label, types, etc.) they want to get those value
        total = total || extractInfo(expenseDocument, ['total amount paid', 'total amount inc', 'balance due'])
        abn = abn || extractInfo(expenseDocument, ['abn'])
        invoiceValue = invoiceValue || extractInfo(expenseDocument, ['order id', 'invoice no', 'invoice number'])
        invoiceDate = invoiceDate || extractInfo(expenseDocument, ['order date', 'invoice date', 'issue date'])
      }

      admin
        .firestore()
        .collection('invoices')
        .doc(doc.id)
        .update({ total, abn: abn || null, invoiceValue, invoiceDate, status: 'Done' })
    } catch (error) {
      admin.firestore().collection('invoices').doc(doc.id).update({ status: 'Error' })
      functions.logger.error('Error retrieving documents', error)
    } finally {
      total = null
      abn = null
      invoiceValue = null
      invoiceDate = null
    }

    functions.logger.log('Done processing documents')
  }
})

// expense documents contains Blocks, SummaryFields & LineItemGroups
// priority is SummaryFields, LineItemGroups then Blocks
const extractInfo = (expenseDocument, keys) => {
  // first try to extract on Blocks
  var data = expenseDocument.SummaryFields.find((x) =>
    keys.some((a) =>
      x?.LabelDetection?.Text?.toLowerCase()
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .includes(a.toLowerCase())
    )
  )
  if (data) return cleanValue(data.ValueDetection.Text)

  data = expenseDocument.LineItemGroups.find((x) =>
    x?.LineItems.some((y) =>
      y.LineItemExpenseFields.some((z) =>
        keys.some((a) =>
          z?.Type?.Text?.toLowerCase()
            .replace(/(\r\n|\n|\r)/gm, ' ')
            .includes(a.toLowerCase())
        )
      )
    )
  )

  if (data) {
    const lineItemExpenseField = data?.LineItems.flatMap((lineItem) => lineItem.LineItemExpenseFields).find((z) =>
      keys.some((a) =>
        z?.Type?.Text?.toLowerCase()
          .replace(/(\r\n|\n|\r)/gm, ' ')
          .includes(a.toLowerCase())
      )
    )
    return cleanValue(lineItemExpenseField.ValueDetection.Text)
  }

  data = expenseDocument.Blocks.find((x) =>
    keys.some((a) =>
      x?.Text?.toLowerCase()
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .includes(a.toLowerCase())
    )
  )
  if (data) return cleanValue(data.Text)
}

const cleanValue = (value) => {
  if (value.includes(':')) {
    var splitValue = value.split(':').splice(0, 1)
    return splitValue.join(':')
  }

  return value
}

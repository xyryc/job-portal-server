const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();

// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://job-square.web.app",
      "https://job-square.firebaseapp.com",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const verifiyToken = (req, res, next) => {
  // console.log("inside verify token middleware", req.cookies);
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (error, decoded) => {
    if (error) {
      return res.status(401).send({ message: "Unauthorized access" });
    }
    req.user = decoded;

    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.t08r2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  // try {
  // Connect the client to the server	(optional starting in v4.7)
  // await client.connect();
  // Send a ping to confirm a successful connection
  // await client.db("admin").command({ ping: 1 });
  // console.log(
  // "Pinged your deployment. You successfully connected to MongoDB!"
  // );

  const jobsCollection = client.db("job_portal").collection("jobs");
  const jobApplicationsCollection = client
    .db("job_portal")
    .collection("job_applications");

  // jwt secret generation: node> require('crypto').randomBytes(64).toString('hex')
  // Auth related APIs
  app.post("/jwt", async (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.JWT_SECRET, {
      expiresIn: "10h",
    });
    res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
  });

  app.post("/logout", async (req, res) => {
    res
      .clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
  });

  // jobs related APIs
  app.get("/jobs", async (req, res) => {
    const email = req.query.email;

    let query = {};
    if (email) {
      query = { hr_email: email };
    }

    const cursor = jobsCollection.find(query);
    const result = await cursor.toArray();
    res.send(result);
  });

  app.get("/jobs/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await jobsCollection.findOne(query);
    res.send(result);
  });

  app.post("/jobs", async (req, res) => {
    const newJob = req.body;
    const result = await jobsCollection.insertOne(newJob);
    res.send(result);
  });

  app.delete("/job/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await jobsCollection.deleteOne(query);
    res.send(result);
  });

  // job application APIs
  app.get("/job-applications", verifiyToken, async (req, res) => {
    const email = req.query.email;
    const query = { applicant_email: email };

    if (req.user.email !== req.query.email) {
      return res.status(403).send({ message: "Access forbidden" });
    }

    const result = await jobApplicationsCollection.find(query).toArray();

    // filter job info
    for (const application of result) {
      const jobQuery = { _id: new ObjectId(application.job_id) };
      const jobResult = await jobsCollection.findOne(jobQuery);
      if (jobResult) {
        application.title = jobResult.title;
        application.company = jobResult.company;
        application.company_logo = jobResult.company_logo;
        application.location = jobResult.location;
        application.jobType = jobResult.jobType;
        application.category = jobResult.category;
        application.hr_name = jobResult.hr_name;
      }
    }
    res.send(result);
  });

  app.get("/job-applications/jobs/:job_id", async (req, res) => {
    const jobId = req.params.job_id;
    const query = { job_id: jobId };
    const result = await jobApplicationsCollection.find(query).toArray();
    res.send(result);
  });

  app.post("/job-applications", async (req, res) => {
    const application = req.body;
    const result = await jobApplicationsCollection.insertOne(application);

    // not the best way (use aggregate)
    const id = application.job_id;
    const query = { _id: new ObjectId(id) };
    const job = await jobsCollection.findOne(query);
    let newCount = 0;
    if (job.applicationCount) {
      newCount = job.applicationCount + 1;
    } else {
      newCount = 1;
    }

    // update the job info
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: {
        applicationCount: newCount,
      },
    };

    const updatedResult = await jobsCollection.updateOne(filter, updatedDoc);
    res.send(result);
  });

  app.patch("/job-applications/:id", async (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: {
        status: data.status,
      },
    };
    const result = await jobApplicationsCollection.updateOne(
      filter,
      updatedDoc
    );
    res.send(result);
  });

  // delete applied position
  app.delete("/job-application/delete/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const findJob = await jobApplicationsCollection.findOne(query);
    const jobId = { _id: new ObjectId(findJob.job_id) };
    const job = await jobsCollection.findOne(jobId);

    const updatedDoc = {
      $set: {
        applicationCount: job.applicationCount - 1,
      },
    };

    const updatedResult = await jobsCollection.updateOne(jobId, updatedDoc);

    const result = await jobApplicationsCollection.deleteOne(query);
    res.send(result);
  });

  // } finally {
  // Ensures that the client will close when you finish/error
  // await client.close();
  // }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Job portal server running");
});

app.listen(port, () => {
  console.log(`Server is running at port: ${port}`);
});
